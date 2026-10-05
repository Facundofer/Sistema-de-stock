from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import Field as PydanticField
from sqlmodel import Field, Session, SQLModel, create_engine, select

BASE_DIR = Path(__file__).resolve().parent
DATABASE_URL = f"sqlite:///{(BASE_DIR / 'stock.db').as_posix()}"
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})


class ProductBase(SQLModel):
    sku: str = Field(index=True, min_length=1, max_length=40)
    name: str = Field(index=True, min_length=1, max_length=120)
    category: str = Field(default="General", max_length=80)
    stock: int = Field(default=0, ge=0)
    min_stock: int = Field(default=5, ge=0)
    price: float = Field(default=0, ge=0)


class Product(ProductBase, table=True):
    id: int | None = Field(default=None, primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ProductCreate(ProductBase):
    pass


class ProductUpdate(SQLModel):
    sku: str | None = PydanticField(default=None, min_length=1, max_length=40)
    name: str | None = PydanticField(default=None, min_length=1, max_length=120)
    category: str | None = PydanticField(default=None, max_length=80)
    min_stock: int | None = PydanticField(default=None, ge=0)
    price: float | None = PydanticField(default=None, ge=0)


class MovementCreate(SQLModel):
    kind: Literal["entrada", "salida"]
    quantity: int = Field(gt=0)
    note: str = Field(default="", max_length=200)


class StockMovement(SQLModel, table=True):
    id: int | None = Field(default=None, primary_key=True)
    product_id: int = Field(foreign_key="product.id", index=True)
    kind: str
    quantity: int
    note: str = ""
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)


def create_db_and_tables() -> None:
    SQLModel.metadata.create_all(engine)


def get_session():
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_session)]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    create_db_and_tables()
    yield


app = FastAPI(title="Stock Simple", version="1.0.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


@app.get("/", include_in_schema=False)
def home():
    return FileResponse(BASE_DIR / "static" / "index.html")


def normalizar_sku(sku: str) -> str:
    return sku.strip().upper()


def verificar_sku_disponible(session: Session, sku: str, exclude_id: int | None = None) -> str:
    sku = normalizar_sku(sku)
    if not sku:
        raise HTTPException(status_code=422, detail="El SKU no puede quedar vacío.")
    consulta = select(Product).where(Product.sku == sku)
    existente = session.exec(consulta).first()
    if existente and existente.id != exclude_id:
        raise HTTPException(status_code=409, detail="Ya existe un producto con ese código SKU.")
    return sku


@app.get("/api/dashboard")
def dashboard(session: SessionDep):
    products = session.exec(select(Product)).all()
    return {
        "product_count": len(products),
        "low_stock_count": sum(1 for item in products if item.stock <= item.min_stock),
        "total_units": sum(item.stock for item in products),
        "inventory_value": round(sum(item.stock * item.price for item in products), 2),
    }


@app.get("/api/products", response_model=list[Product])
def list_products(
    session: SessionDep,
    q: str = Query(default="", max_length=120),
    low_stock: bool = False,
):
    products = session.exec(select(Product).order_by(Product.name)).all()
    query = q.strip().casefold()
    if query:
        products = [p for p in products if query in p.name.casefold() or query in p.sku.casefold() or query in p.category.casefold()]
    if low_stock:
        products = [p for p in products if p.stock <= p.min_stock]
    return products


@app.post("/api/products", response_model=Product, status_code=201)
def create_product(data: ProductCreate, session: SessionDep):
    values = data.model_dump()
    values["sku"] = verificar_sku_disponible(session, data.sku)
    values["name"] = data.name.strip()
    if not values["name"]:
        raise HTTPException(status_code=422, detail="El nombre del producto no puede quedar vacío.")
    values["category"] = data.category.strip() or "General"
    product = Product(**values)
    session.add(product)
    session.commit()
    session.refresh(product)
    if product.stock > 0:
        session.add(StockMovement(product_id=product.id, kind="entrada", quantity=product.stock, note="Stock inicial"))
        session.commit()
        session.refresh(product)
    return product


@app.put("/api/products/{product_id}", response_model=Product)
def update_product(product_id: int, data: ProductUpdate, session: SessionDep):
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    values = data.model_dump(exclude_unset=True)
    if "sku" in values and values["sku"] is not None:
        values["sku"] = verificar_sku_disponible(session, values["sku"], product_id)
    if "name" in values and values["name"] is not None:
        values["name"] = values["name"].strip()
        if not values["name"]:
            raise HTTPException(status_code=422, detail="El nombre del producto no puede quedar vacío.")
    if "category" in values and values["category"] is not None:
        values["category"] = values["category"].strip() or "General"
    product.sqlmodel_update(values)
    session.add(product)
    session.commit()
    session.refresh(product)
    return product


@app.delete("/api/products/{product_id}")
def delete_product(product_id: int, session: SessionDep):
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    movements = session.exec(select(StockMovement).where(StockMovement.product_id == product_id)).all()
    for movement in movements:
        session.delete(movement)
    session.delete(product)
    session.commit()
    return {"ok": True}


@app.post("/api/products/{product_id}/movements", status_code=201)
def create_movement(product_id: int, data: MovementCreate, session: SessionDep):
    product = session.get(Product, product_id)
    if product is None:
        raise HTTPException(status_code=404, detail="Producto no encontrado.")
    if data.kind == "salida" and data.quantity > product.stock:
        raise HTTPException(status_code=400, detail="No hay stock suficiente para registrar esa salida.")
    if data.kind == "entrada":
        product.stock += data.quantity
    else:
        product.stock -= data.quantity
    movement = StockMovement(
        product_id=product_id,
        kind=data.kind,
        quantity=data.quantity,
        note=data.note.strip(),
    )
    session.add(product)
    session.add(movement)
    session.commit()
    session.refresh(product)
    session.refresh(movement)
    return {"movement": movement, "product": product}


@app.get("/api/movements")
def list_movements(session: SessionDep, limit: int = Query(default=8, ge=1, le=50)):
    movements = session.exec(select(StockMovement).order_by(StockMovement.created_at.desc()).limit(limit)).all()
    result = []
    for movement in movements:
        product = session.get(Product, movement.product_id)
        result.append({
            "id": movement.id,
            "product_id": movement.product_id,
            "product_name": product.name if product else "Producto eliminado",
            "kind": movement.kind,
            "quantity": movement.quantity,
            "note": movement.note,
            "created_at": movement.created_at,
        })
    return result
