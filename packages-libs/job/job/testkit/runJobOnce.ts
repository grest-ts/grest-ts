import type {GGJob} from "../src/GGJob"
import {inJobRowContext, inJobRunContext} from "../src/jobContext"

/** One batch, no runner and no locks: a job's own logic in a unit test, in the same run and row contexts as the
 *  runner's. Row errors are returned, not thrown. */
export function runJobOnce<Row>(job: GGJob<Row>): Promise<{rows: Row[], errors: unknown[]}> {
    return inJobRunContext(async () => {
        const rows = await job.getDataSet(job.config.settings.get().limit ?? Number.MAX_SAFE_INTEGER)
        const errors: unknown[] = []
        for (const row of rows) await inJobRowContext(() => job.processRow(row, new AbortController().signal)).catch(err => errors.push(err))
        return {rows, errors}
    })
}
