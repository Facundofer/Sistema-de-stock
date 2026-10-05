const api = "/api";
const byId = (id) => document.getElementById(id);
const productForm = byId("product-form");
const movementForm = byId("movement-form");
const productDialog = byId("product-dialog");
const movementDialog = byId("movement-dialog");
let products = [];
let onlyLowStock = false;
let searchTimer;
let toastTimer;

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 2 });
const number = new Intl.NumberFormat("es-AR");

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    let detail = "Ocurrió un error. Intentá de nuevo.";
    try {
      const body = await response.json();
      if (Array.isArray(body.detail)) detail = body.detail.map((item) => item.msg).join(" · ");
      else if (body.detail) detail = body.detail;
    } catch (_) { /* La respuesta puede no incluir JSON. */ }
    throw new Error(detail);
  }
  if (response.status === 204) return null;
  return response.json();
}

function notify(message, isError = false) {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

async function refreshDashboard() {
  const data = await request(`${api}/dashboard`);
  byId("stat-products").textContent = number.format(data.product_count);
  byId("stat-units").textContent = number.format(data.total_units);
  byId("stat-low").textContent = number.format(data.low_stock_count);
  byId("stat-value").textContent = money.format(data.inventory_value);
}

async function refreshProducts() {
  const params = new URLSearchParams();
  const search = byId("search").value.trim();
  if (search) params.set("q", search);
  if (onlyLowStock) params.set("low_stock", "true");
  products = await request(`${api}/products?${params.toString()}`);
  renderProducts();
}

function renderProducts() {
  const table = byId("products-table");
  byId("clear-filter").classList.toggle("hidden", !onlyLowStock);
  byId("product-count").textContent = `${products.length} producto${products.length === 1 ? "" : "s"}`;
  if (!products.length) {
    table.innerHTML = '<tr><td colspan="7" class="empty-cell">No hay productos para mostrar. Agregá uno para empezar.</td></tr>';
    return;
  }
  table.innerHTML = products.map((product) => {
    let status = '<span class="stock-badge badge-ok">Disponible</span>';
    if (product.stock === 0) status = '<span class="stock-badge badge-empty">Sin stock</span>';
    else if (product.stock <= product.min_stock) status = '<span class="stock-badge badge-low">Stock bajo</span>';
    return `<tr>
      <td class="product-name" title="${escapeHTML(product.name)}">${escapeHTML(product.name)}</td>
      <td><span class="category-tag">${escapeHTML(product.category || "General")}</span></td>
      <td class="sku">${escapeHTML(product.sku)}</td>
      <td class="price">${money.format(product.price)}</td>
      <td class="stock-value">${number.format(product.stock)} <span style="font-weight:400;color:#96a0ae">/ mín. ${number.format(product.min_stock)}</span></td>
      <td>${status}</td>
      <td><div class="row-actions">
        <button class="icon-button" data-action="movement" data-id="${product.id}" title="Registrar entrada o salida">↕ Stock</button>
        <button class="icon-button" data-action="edit" data-id="${product.id}" title="Editar producto">✎</button>
        <button class="icon-button delete" data-action="delete" data-id="${product.id}" title="Eliminar producto">×</button>
      </div></td>
    </tr>`;
  }).join("");
}

function formatDate(value) {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

async function refreshMovements() {
  const movements = await request(`${api}/movements?limit=8`);
  const container = byId("movements-list");
  if (!movements.length) {
    container.innerHTML = '<div class="empty-state">Todavía no hay movimientos. Usá “↕ Stock” en un producto para registrar una entrada o salida.</div>';
    return;
  }
  container.innerHTML = movements.map((item) => {
    const entry = item.kind === "entrada";
    const sign = entry ? "+" : "−";
    const typeLabel = entry ? "Entrada de stock" : "Salida de stock";
    return `<div class="movement-row">
      <span class="movement-symbol ${entry ? "movement-in" : "movement-out"}">${entry ? "↓" : "↑"}</span>
      <div><div class="movement-title">${escapeHTML(item.product_name)} · ${typeLabel}</div><div class="movement-note">${escapeHTML(item.note || "Sin nota")}</div></div>
      <div class="movement-quantity ${entry ? "quantity-in" : "quantity-out"}">${sign}${number.format(item.quantity)}</div>
      <div class="movement-date">${formatDate(item.created_at)}</div>
    </div>`;
  }).join("");
}

async function refreshAll() {
  try {
    await Promise.all([refreshDashboard(), refreshProducts(), refreshMovements()]);
  } catch (error) {
    byId("products-table").innerHTML = `<tr><td colspan="7" class="empty-cell">No se pudo conectar con el servidor: ${escapeHTML(error.message)}</td></tr>`;
  }
}

function openNewProduct() {
  productForm.reset();
  byId("product-id").value = "";
  byId("product-dialog-title").textContent = "Nuevo producto";
  byId("save-product").textContent = "Guardar producto";
  byId("initial-stock-label").classList.remove("hidden");
  productDialog.showModal();
}

function openEditProduct(product) {
  productForm.reset();
  byId("product-id").value = product.id;
  for (const field of ["name", "sku", "category", "price", "min_stock"]) {
    productForm.elements[field].value = product[field] ?? "";
  }
  byId("product-dialog-title").textContent = "Editar producto";
  byId("save-product").textContent = "Guardar cambios";
  byId("initial-stock-label").classList.add("hidden");
  productDialog.showModal();
}

function openMovement(product) {
  movementForm.reset();
  movementForm.elements.quantity.value = 1;
  byId("movement-product-id").value = product.id;
  byId("movement-product-name").textContent = `${product.name} · stock actual: ${product.stock}`;
  movementDialog.showModal();
}

byId("add-product").addEventListener("click", openNewProduct);
byId("search").addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => refreshProducts().catch((error) => notify(error.message, true)), 180);
});
byId("low-stock-card").addEventListener("click", () => {
  onlyLowStock = !onlyLowStock;
  refreshProducts().catch((error) => notify(error.message, true));
});
byId("clear-filter").addEventListener("click", () => {
  onlyLowStock = false;
  refreshProducts().catch((error) => notify(error.message, true));
});
byId("nav-inventory").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
byId("nav-movements").addEventListener("click", () => byId("movement-section").scrollIntoView({ behavior: "smooth" }));

document.querySelectorAll("[data-close]").forEach((button) => {
  button.addEventListener("click", () => byId(button.dataset.close).close());
});
document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
});

productForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(productForm);
  const payload = {
    name: form.get("name").trim(),
    sku: form.get("sku").trim(),
    category: form.get("category").trim() || "General",
    price: Number(form.get("price")),
    min_stock: Number(form.get("min_stock")),
  };
  const id = byId("product-id").value;
  if (!id) payload.stock = Number(form.get("stock"));
  try {
    await request(id ? `${api}/products/${id}` : `${api}/products`, {
      method: id ? "PUT" : "POST", body: JSON.stringify(payload),
    });
    productDialog.close();
    notify(id ? "Producto actualizado." : "Producto agregado.");
    await refreshAll();
  } catch (error) { notify(error.message, true); }
});

movementForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(movementForm);
  const id = byId("movement-product-id").value;
  try {
    await request(`${api}/products/${id}/movements`, {
      method: "POST",
      body: JSON.stringify({ kind: form.get("kind"), quantity: Number(form.get("quantity")), note: form.get("note").trim() }),
    });
    movementDialog.close();
    notify("Movimiento registrado.");
    await refreshAll();
  } catch (error) { notify(error.message, true); }
});

byId("products-table").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const product = products.find((item) => item.id === Number(button.dataset.id));
  if (!product) return;
  if (button.dataset.action === "edit") openEditProduct(product);
  if (button.dataset.action === "movement") openMovement(product);
  if (button.dataset.action === "delete") {
    if (!window.confirm(`¿Eliminar “${product.name}”? También se eliminará su historial de movimientos.`)) return;
    try {
      await request(`${api}/products/${product.id}`, { method: "DELETE" });
      notify("Producto eliminado.");
      await refreshAll();
    } catch (error) { notify(error.message, true); }
  }
});

refreshAll();
