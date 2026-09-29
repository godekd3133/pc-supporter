export function statementsFrom(sql) {
  const statements = [];
  let start = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (inSingleQuote) {
      if (char === "'" && sql[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && sql[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === ";") {
      const statement = sql.slice(start, index).trim();
      if (statement) statements.push(statement);
      start = index + 1;
    }
  }
  const trailing = sql.slice(start).trim();
  if (trailing) statements.push(trailing);
  if (inSingleQuote || inDoubleQuote) throw new Error("PostgreSQL schema has an unterminated SQL quote.");
  return statements;
}

export function normalizedSql(sql) {
  let output = "";
  let pendingSpace = false;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (inSingleQuote) {
      output += char;
      if (char === "'" && sql[index + 1] === "'") output += sql[++index];
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      output += char;
      if (char === '"' && sql[index + 1] === '"') output += sql[++index];
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && output && !/[\s(]/.test(output.at(-1)) && !/[),;]/.test(char)) output += " ";
    pendingSpace = false;
    output += char;
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
  }
  return output.trim();
}

function matchingCloseParen(source, openIndex) {
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inSingleQuote) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && source[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index;
  }
  throw new Error("PostgreSQL schema has unbalanced parentheses.");
}

function splitTopLevel(source) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inSingleQuote) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && source[index + 1] === '"') index += 1;
      else if (char === '"') inDoubleQuote = false;
      continue;
    }
    if (char === "'") inSingleQuote = true;
    else if (char === '"') inDoubleQuote = true;
    else if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    else if (char === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}

function unquoteIdentifier(value) {
  return value.replace(/^"|"$/g, "").replaceAll('""', '"').toLowerCase();
}

function splitColumns(source) {
  return splitTopLevel(source).map((column) => unquoteIdentifier(column.trim()));
}

function schemaDataType(sqlType) {
  const normalized = sqlType.trim().replace(/\s+/g, " ").toUpperCase();
  const base = normalized.replace(/\s*\([^)]*\)/g, "").trim();
  const types = {
    TEXT: "text",
    JSONB: "jsonb",
    TIMESTAMPTZ: "timestamp with time zone",
    "TIMESTAMP WITH TIME ZONE": "timestamp with time zone",
    DATE: "date",
    INTEGER: "integer",
    INT: "integer",
    UUID: "uuid",
    BOOLEAN: "boolean",
    SMALLINT: "smallint",
    BIGINT: "bigint",
    BYTEA: "bytea",
    CHAR: "character",
    CHARACTER: "character",
    VARCHAR: "character varying",
    "CHARACTER VARYING": "character varying",
    NUMERIC: "numeric",
    DECIMAL: "numeric",
    REAL: "real",
    "DOUBLE PRECISION": "double precision"
  };
  const result = types[base];
  if (!result) throw new Error(`Unsupported PostgreSQL column type in current schema: ${base}`);
  return result;
}

function addKeyConstraint(target, tableName, constraintType, columns) {
  target.push({ tableName, constraintType, columns });
}

function parseIndexDefinition(statement) {
  const match = statement.match(/^CREATE\s+(UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s]+)\s+ON\s+([^\s(]+)(?:\s+USING\s+[^\s(]+)?\s*\(/i);
  if (!match) throw new Error("PostgreSQL schema contains an unsupported index statement.");
  const tableName = unquoteIdentifier(match[3].split(".").at(-1));
  const openIndex = statement.indexOf("(", match[0].length - 1);
  const closeIndex = matchingCloseParen(statement, openIndex);
  const columns = splitColumns(statement.slice(openIndex + 1, closeIndex));
  return {
    tableName,
    indexName: unquoteIdentifier(match[2]),
    unique: Boolean(match[1]),
    keyColumns: columns
  };
}

export function parsePostgresIndexDefinition(statement) {
  return parseIndexDefinition(statement);
}

export function effectiveSchema(sql) {
  const tables = new Map();
  const indexes = new Set();

  for (const statement of statementsFrom(sql)) {
    const tableMatch = statement.match(/^CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
    if (tableMatch) {
      const tableName = tableMatch[1].toLowerCase();
      const openIndex = statement.indexOf("(", tableMatch[0].length - 1);
      const closeIndex = matchingCloseParen(statement, openIndex);
      const declarations = splitTopLevel(statement.slice(openIndex + 1, closeIndex));
      const columns = tables.get(tableName) ?? new Set();
      for (const declaration of declarations) columns.add(normalizedSql(declaration));
      tables.set(tableName, columns);
      continue;
    }

    const alterMatch = statement.match(/^ALTER TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s+ADD COLUMN IF NOT EXISTS\s+([\s\S]+)$/i);
    if (alterMatch) {
      const tableName = alterMatch[1].toLowerCase();
      const columns = tables.get(tableName) ?? new Set();
      columns.add(normalizedSql(alterMatch[2]));
      tables.set(tableName, columns);
      continue;
    }

    if (/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS\s+/i.test(statement)) {
      indexes.add(normalizedSql(statement));
      continue;
    }

    throw new Error(`Unrecognized PostgreSQL schema statement: ${statement.slice(0, 80)}`);
  }

  return {
    tables: new Map([...tables.entries()].map(([name, columns]) => [name, [...columns].sort()])),
    indexes: [...indexes].sort()
  };
}

export function postgresSchemaContractFromSql(sql) {
  const parsed = effectiveSchema(sql);
  const tables = [...parsed.tables.keys()].sort();
  const columns = [];
  const keyConstraints = [];
  const constraintCounts = new Map();

  for (const [tableName, declarations] of parsed.tables) {
    const primaryKeyColumns = new Set();
    const tableLevelKeys = [];
    const columnDeclarations = [];
    for (const declaration of declarations) {
      const body = declaration.replace(/^CONSTRAINT\s+(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)\s+/i, "");
      let match = body.match(/^PRIMARY KEY\s*\(([^)]*)\)/i);
      if (match) {
        const keyColumns = splitColumns(match[1]);
        for (const columnName of keyColumns) primaryKeyColumns.add(columnName);
        tableLevelKeys.push({ tableName, constraintType: "PRIMARY KEY", columns: keyColumns });
        continue;
      }
      match = body.match(/^UNIQUE\s*\(([^)]*)\)/i);
      if (match) {
        tableLevelKeys.push({ tableName, constraintType: "UNIQUE", columns: splitColumns(match[1]) });
        continue;
      }
      if (/^(?:CHECK\s*\(|CONSTRAINT\s+[^\s]+\s+CHECK\s*\()/i.test(body)) {
        const key = `${tableName}\0CHECK`;
        constraintCounts.set(key, (constraintCounts.get(key) ?? 0) + 1);
        continue;
      }
      if (/^FOREIGN KEY\s*\(/i.test(body)) {
        const key = `${tableName}\0FOREIGN KEY`;
        constraintCounts.set(key, (constraintCounts.get(key) ?? 0) + 1);
        continue;
      }
      columnDeclarations.push(body);
    }

    for (const declaration of columnDeclarations) {
      const match = declaration.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+(TIMESTAMP\s+WITH\s+TIME\s+ZONE|DOUBLE\s+PRECISION|CHARACTER\s+VARYING|[A-Za-z]+)(?:\s*\([^)]*\))?(?:\[\])?([\s\S]*)$/i);
      if (!match) throw new Error(`Unrecognized column declaration in current schema table ${tableName}.`);
      const columnName = match[1].toLowerCase();
      const sqlType = match[2];
      const suffix = match[3];
      const inlinePrimaryKey = /\bPRIMARY KEY\b/i.test(suffix);
      const inlineUnique = /\bUNIQUE\b/i.test(suffix);
      const inlineCheck = /\bCHECK\s*\(/i.test(suffix);
      const inlineForeignKey = /\bREFERENCES\b/i.test(suffix);
      if (inlinePrimaryKey) {
        primaryKeyColumns.add(columnName);
        tableLevelKeys.push({ tableName, constraintType: "PRIMARY KEY", columns: [columnName] });
      }
      if (inlineUnique) tableLevelKeys.push({ tableName, constraintType: "UNIQUE", columns: [columnName] });
      if (inlineCheck) {
        const key = `${tableName}\0CHECK`;
        constraintCounts.set(key, (constraintCounts.get(key) ?? 0) + 1);
      }
      if (inlineForeignKey) {
        const key = `${tableName}\0FOREIGN KEY`;
        constraintCounts.set(key, (constraintCounts.get(key) ?? 0) + 1);
      }
      columns.push({
        tableName,
        columnName,
        dataType: schemaDataType(sqlType),
        nullable: !/\bNOT NULL\b/i.test(suffix) && !inlinePrimaryKey
      });
    }
    keyConstraints.push(...tableLevelKeys);
    for (const columnName of primaryKeyColumns) {
      const column = columns.find((item) => item.tableName === tableName && item.columnName === columnName);
      if (column) column.nullable = false;
    }
  }

  const indexDefinitions = parsed.indexes.map((indexSql) => parseIndexDefinition(indexSql));
  const countedConstraints = [...constraintCounts.entries()].map(([key, count]) => {
    const [tableName, constraintType] = key.split("\0");
    return { tableName, constraintType, count };
  }).sort((left, right) => left.tableName.localeCompare(right.tableName) || left.constraintType.localeCompare(right.constraintType));
  return {
    tables,
    columns: columns.sort((left, right) => left.tableName.localeCompare(right.tableName) || left.columnName.localeCompare(right.columnName)),
    indexes: indexDefinitions.sort((left, right) => left.indexName.localeCompare(right.indexName)),
    keyConstraints: keyConstraints.sort((left, right) => left.tableName.localeCompare(right.tableName) || left.constraintType.localeCompare(right.constraintType) || left.columns.join(",").localeCompare(right.columns.join(","))),
    countedConstraints
  };
}
