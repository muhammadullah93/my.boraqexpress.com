export function productScope(user, alias = 'p') {
  if (user.role === 'supplier') return { sql: `${alias}.supplier_user_id = ?`, params: [user.id] };
  if (user.role === 'dropshipper') return { sql: `${alias}.status = 'active'`, params: [] };
  return { sql: '1 = 1', params: [] };
}

export function orderScope(user, alias = 'o') {
  if (user.role === 'supplier') return { sql: `${alias}.supplier_user_id = ?`, params: [user.id] };
  if (user.role === 'dropshipper') return { sql: `${alias}.dropshipper_user_id = ?`, params: [user.id] };
  return { sql: '1 = 1', params: [] };
}

export function productForRole(product, role) {
  const result = { ...product };
  result.available = Number(result.stock) - Number(result.reserved);
  if (role === 'dropshipper') {
    delete result.supplier_user_id;
    delete result.supplier_name;
    delete result.supplier_price;
    delete result.proposed_supplier_price;
    delete result.created_by;
    delete result.stock;
    delete result.reserved;
  }
  return result;
}

export function orderForRole(order, role) {
  const result = { ...order };
  if (role === 'supplier') {
    delete result.dropshipper_user_id;
    delete result.dropshipper_name;
    delete result.created_by;
    delete result.amount;
  }
  if (role === 'dropshipper') {
    delete result.supplier_user_id;
    delete result.supplier_name;
  }
  return result;
}

export function orderItemForRole(item, role) {
  const result = { ...item };
  if (role === 'supplier') delete result.unit_price;
  return result;
}
