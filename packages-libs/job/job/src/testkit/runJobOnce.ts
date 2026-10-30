import type {GGJob} from "../GGJob"

/** One batch, no runner and no locks: a job's own logic in a unit test. Row errors are returned, not thrown. */
export async function runJobOnce<Row>(job: GGJob<Row>): Promise<{rows: Row[], errors: unknown[]}> {
    const rows = await job.getDataSet(job.config.limit ?? Number.MAX_SAFE_INTEGER)
    const errors: unknown[] = []
    for (const row of rows) await job.processRow(row, new AbortController().signal).catch(err => errors.push(err))
    return {rows, errors}
}
