# Stock Simple

Aplicación local de inventario con FastAPI, SQLModel y SQLite. Tiene una interfaz web en español para administrar productos, buscar artículos, ver alertas de stock bajo y registrar entradas y salidas. Los movimientos quedan guardados como historial.

## Requisitos

- Python 3.10 o superior
- pip

## Instalar y ejecutar en Windows

Desde una terminal, ubicándose en la carpeta `stock_app`:

```powershell
py -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload
```
## Instalar y ejecutar en Linux

Desde una terminal, ubicándose en la carpeta `stock_app`:

```powershell
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --reload
```

Después abrí <http://127.0.0.1:8000>. La base `stock.db` se crea automáticamente junto a `app.py`. La API interactiva está en <http://127.0.0.1:8000/docs>.

## Funciones

- Crear, editar y eliminar productos (SKU único, nombre, categoría, precio, stock y mínimo).
- Buscar por nombre, SKU o categoría.
- Registrar entradas y salidas; no permite retirar más unidades de las disponibles.
- Ver indicadores de productos, unidades, valor de stock y artículos por debajo del mínimo.
- Consultar los últimos movimientos.
