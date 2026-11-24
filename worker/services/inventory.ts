export async function lockKeysForOrder(
  db: D1Database,
  variantId: string,
  orderId: string,
  quantity: number,
  lockDurationMs = 15 * 60 * 1000
): Promise<string[]> {
  const lockUntil = Date.now() + lockDurationMs;

  const { results } = await db
    .prepare(
      `UPDATE inventory_keys
       SET status = 'LOCKED', locked_order_id = ?1, locked_until = ?2
       WHERE id IN (
         SELECT id FROM inventory_keys
         WHERE variant_id = ?3 AND status = 'AVAILABLE'
         ORDER BY created_at ASC
         LIMIT ?4
       )
       RETURNING id`
    )
    .bind(orderId, lockUntil, variantId, quantity)
    .all<{ id: string }>();

  const lockedIds = results.map((r) => r.id);

  // 高并发下若锁到的数量不足，立即回滚释放
  if (lockedIds.length < quantity) {
    if (lockedIds.length > 0) {
      await db
        .prepare(
          `UPDATE inventory_keys
           SET status = 'AVAILABLE', locked_order_id = NULL, locked_until = NULL
           WHERE locked_order_id = ?1 AND status = 'LOCKED'`
        )
        .bind(orderId)
        .run();
    }
    return [];
  }

  return lockedIds;
}

export async function releaseExpiredOrdersAndKeys(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch([
    db
      .prepare(
        `UPDATE inventory_keys
         SET status = 'AVAILABLE', locked_order_id = NULL, locked_until = NULL
         WHERE status = 'LOCKED' AND locked_until < ?1`
      )
      .bind(now),
    db
      .prepare(
        `UPDATE orders
         SET status = 'EXPIRED', updated_at = ?1
         WHERE status IN ('CREATED', 'PENDING_PAYMENT') AND expires_at < ?1`
      )
      .bind(now),
  ]);
}
