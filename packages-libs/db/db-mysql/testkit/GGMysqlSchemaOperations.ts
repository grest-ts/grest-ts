import mysql, {Connection, RowDataPacket} from 'mysql2/promise';
import * as fs from 'fs';
import * as path from 'path';

export interface GGMysqlSchemaOperationsConfig {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
}

export class GGMysqlSchemaOperations {
    private connection: Connection | null = null;
    private config: GGMysqlSchemaOperationsConfig;

    constructor(config: GGMysqlSchemaOperationsConfig) {
        this.config = config;
    }

    async connect(): Promise<void> {
        if (this.connection) {
            return;
        }
        this.connection = await mysql.createConnection({
            host: this.config.host,
            port: this.config.port,
            user: this.config.user,
            password: this.config.password,
        });
    }

    async disconnect(): Promise<void> {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
        }
    }

    private getConnection(): Connection {
        if (!this.connection) {
            throw new Error('MysqlSchemaOperations not connected. Call connect() first.');
        }
        return this.connection;
    }

    // ==================== Schema operations ====================

    async schemaExists(schema: string): Promise<boolean> {
        const [rows] = await this.getConnection().query<RowDataPacket[]>(
            `SELECT SCHEMA_NAME
             FROM information_schema.SCHEMATA
             WHERE SCHEMA_NAME = ?`,
            [schema]
        );
        return rows.length > 0;
    }

    async createSchema(schema: string): Promise<void> {
        await this.getConnection().query(`CREATE SCHEMA IF NOT EXISTS \`${schema}\``);
    }

    async dropSchema(schema: string): Promise<void> {
        await this.getConnection().query(`DROP SCHEMA IF EXISTS \`${schema}\``);
    }

    async cloneSchema(sourceSchema: string, targetSchema: string): Promise<void> {
        const conn = this.getConnection();
        await this.createSchema(targetSchema);

        interface TableRow extends RowDataPacket {
            TABLE_NAME: string;
        }

        const [tables] = await conn.query<TableRow[]>(`SELECT TABLE_NAME
                                                       FROM information_schema.tables
                                                       WHERE table_schema = ?
                                                         AND table_type = 'BASE TABLE'`, [sourceSchema]);
        await conn.query('SET FOREIGN_KEY_CHECKS = 0');
        try {
            for (const table of tables) {
                await conn.query(
                    `CREATE TABLE \`${targetSchema}\`.\`${table.TABLE_NAME}\` LIKE \`${sourceSchema}\`.\`${table.TABLE_NAME}\``
                );
            }
        } finally {
            await conn.query('SET FOREIGN_KEY_CHECKS = 1');
        }
    }

    // ==================== Seed ====================

    async runSeedFiles(schema: string, seedFiles: string[]): Promise<void> {
        const conn = this.getConnection();

        for (const seedFile of seedFiles) {
            const filePath = path.resolve(process.cwd(), seedFile);

            if (!fs.existsSync(filePath)) {
                throw new Error(`Seed file not found: ${filePath}`);
            }

            const sql = fs.readFileSync(filePath, 'utf-8');

            // Remove comment lines first, then split by semicolons
            const cleanedSql = sql
                .split('\n')
                .filter(line => !line.trim().startsWith('--'))
                .join('\n');

            const statements = cleanedSql
                .split(';')
                .map(s => s.trim())
                .filter(s => s.length > 0);

            for (const statement of statements) {
                // Qualify table names with schema for various SQL statements
                let qualifiedStatement = statement;

                // CREATE TABLE table_name or CREATE TABLE IF NOT EXISTS table_name
                qualifiedStatement = qualifiedStatement.replace(
                    /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\w+)/gi,
                    `CREATE TABLE $1\`${schema}\`.$2`
                );

                // INSERT INTO table_name
                qualifiedStatement = qualifiedStatement.replace(
                    /INSERT\s+INTO\s+(\w+)/gi,
                    `INSERT INTO \`${schema}\`.$1`
                );

                // REFERENCES table_name (for foreign keys)
                qualifiedStatement = qualifiedStatement.replace(
                    /REFERENCES\s+(\w+)\s*\(/gi,
                    `REFERENCES \`${schema}\`.$1(`
                );

                await conn.query(qualifiedStatement);
            }
        }
    }
}
