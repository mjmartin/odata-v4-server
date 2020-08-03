import { Connection, QueryRunner } from 'typeorm';
import { v4 } from 'uuid';

const transactionStorage = new Map<string, QueryRunner>();

export interface TransactionContext {
  uuid: string
}

/**
 * create transaction context
 */
export const createTransactionContext = (): TransactionContext => ({
  uuid: v4()
});

/**
 * get/create transaction for context
 *
 * PLEASE remember to rollback/commit it
 *
 * @param conn
 * @param ctx
 */
export async function getOrCreateTransaction(conn: Connection, ctx: TransactionContext): Promise<QueryRunner> {
  if (!transactionStorage.has(ctx.uuid)) {
    const qr = conn.createQueryRunner(); // pool required
    await qr.connect();
    await qr.startTransaction(); // begin transaction
    transactionStorage.set(ctx.uuid, qr);
  }
  return transactionStorage.get(ctx.uuid);
}

async function releaseTransaction(qr: QueryRunner): Promise<void> {
  if (!qr.isReleased) {
    await qr.release();
  }
}

/**
 * rollback transaction if exist
 *
 * @param ctx
 */
export async function rollbackTransaction(ctx: TransactionContext): Promise<void> {
  if (transactionStorage.has(ctx.uuid)) {
    const tx = transactionStorage.get(ctx.uuid);
    await tx.rollbackTransaction();
    await releaseTransaction(tx);
    transactionStorage.delete(ctx.uuid);
  }
}

/**
 * commit transaction if exist
 *
 * @param ctx
 */
export async function commitTransaction(ctx: TransactionContext): Promise<void> {
  if (transactionStorage.has(ctx.uuid)) {
    const tx = transactionStorage.get(ctx.uuid);
    await tx.commitTransaction();
    await releaseTransaction(tx);
    transactionStorage.delete(ctx.uuid);
  }
}

