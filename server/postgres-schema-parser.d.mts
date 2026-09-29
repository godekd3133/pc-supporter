export type EffectivePostgresSchema = {
  tables: Map<string, string[]>;
  indexes: string[];
};

export type PostgresSchemaColumnContract = {
  tableName: string;
  columnName: string;
  dataType: string;
  nullable: boolean;
};

export type PostgresSchemaIndexContract = {
  tableName: string;
  indexName: string;
  unique: boolean;
  keyColumns: string[];
};

export type PostgresSchemaKeyConstraintContract = {
  tableName: string;
  constraintType: "PRIMARY KEY" | "UNIQUE";
  columns: string[];
};

export type PostgresSchemaCountedConstraintContract = {
  tableName: string;
  constraintType: "CHECK" | "FOREIGN KEY";
  count: number;
};

export type PostgresSchemaContractManifest = {
  tables: string[];
  columns: PostgresSchemaColumnContract[];
  indexes: PostgresSchemaIndexContract[];
  keyConstraints: PostgresSchemaKeyConstraintContract[];
  countedConstraints: PostgresSchemaCountedConstraintContract[];
};

export function effectiveSchema(sql: string): EffectivePostgresSchema;
export function normalizedSql(sql: string): string;
export function postgresSchemaContractFromSql(sql: string): PostgresSchemaContractManifest;
export function parsePostgresIndexDefinition(statement: string): PostgresSchemaIndexContract;
