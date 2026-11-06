const { splitTopLevel } = require("./splitTopLevel");

const CREATE_TABLE_PATTERN = /^CREATE TABLE (?:IF NOT EXISTS )?(\w+) \((.*)\)$/i;
const ADD_COLUMN_PATTERN = /^ALTER TABLE (\w+) ADD COLUMN (?:IF NOT EXISTS )?(.+)$/i;
const ADD_CONSTRAINT_PATTERN = /^ALTER TABLE (\w+) ADD (CONSTRAINT (\w+) .+)$/i;
const DROP_CONSTRAINT_PATTERN = /^ALTER TABLE (\w+) DROP CONSTRAINT (?:IF EXISTS )?(\w+)$/i;
const CREATE_INDEX_PATTERN = /^CREATE (UNIQUE )?INDEX (?:IF NOT EXISTS )?(\w+) ON (\w+)(.*)$/i;
const TABLE_CONSTRAINT_PATTERN = /^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i;

// Collapses whitespace so a statement fits on one line
function normalize(statement) {
  return statement.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
}

// Creates an empty table entry if it doesn't exist yet
function tableEntry(tables, name) {
  tables[name] = tables[name] || { columns: [], constraints: [], indexes: [] };

  return tables[name];
}

// Cuts the CHECK clause (with its balanced parentheses) out of a column definition
function removeInlineCheck(column) {
  const start = column.indexOf(" CHECK (");

  if (start === -1) {
    return column;
  }

  let depth = 0;
  let end = start + " CHECK ".length;

  for (; end < column.length; end += 1) {
    if (column[end] === "(") {
      depth += 1;
    } else if (column[end] === ")") {
      depth -= 1;
    }

    if (depth === 0) {
      break;
    }
  }

  return `${column.slice(0, start)}${column.slice(end + 1)}`;
}

// Removes a named constraint, including the inline CHECK that Postgres names table_column_check
function removeConstraint(table, tableName, name) {
  table.constraints = table.constraints.filter((entry) => !entry.startsWith(`CONSTRAINT ${name} `));
  table.columns = table.columns.map((column) => (name === `${tableName}_${column.split(" ")[0]}_check` ? removeInlineCheck(column) : column));
}

// Reads tables, columns, constraints and indexes from schema SQL, applying later ALTER statements
function parseSchema(sql) {
  const tables = {};
  const statements = sql.replace(/--[^\n]*/g, "").split(";").map(normalize).filter(Boolean);

  for (const statement of statements) {
    const create = statement.match(CREATE_TABLE_PATTERN);
    const addColumn = statement.match(ADD_COLUMN_PATTERN);
    const addConstraint = statement.match(ADD_CONSTRAINT_PATTERN);
    const dropConstraint = statement.match(DROP_CONSTRAINT_PATTERN);
    const index = statement.match(CREATE_INDEX_PATTERN);

    if (create) {
      const table = tableEntry(tables, create[1]);

      for (const entry of splitTopLevel(create[2])) {
        (TABLE_CONSTRAINT_PATTERN.test(entry) ? table.constraints : table.columns).push(entry);
      }
    } else if (addColumn) {
      tableEntry(tables, addColumn[1]).columns.push(addColumn[2]);
    } else if (addConstraint) {
      const table = tableEntry(tables, addConstraint[1]);

      removeConstraint(table, addConstraint[1], addConstraint[3]);
      table.constraints.push(addConstraint[2]);
    } else if (dropConstraint) {
      removeConstraint(tableEntry(tables, dropConstraint[1]), dropConstraint[1], dropConstraint[2]);
    } else if (index) {
      tableEntry(tables, index[3]).indexes.push(`${index[1] || ""}${index[2]} ON ${index[3]}${index[4]}`);
    }
  }

  return tables;
}

// Describes one table in full, or lists every table with its column names when no table is given
function describeSchema(sql, tableName) {
  const tables = parseSchema(sql);
  const names = Object.keys(tables);

  if (!tableName) {
    return names.map((name) => `${name}: ${tables[name].columns.map((column) => column.split(" ")[0]).join(", ")}`).join("\n");
  }

  const table = tables[tableName];

  if (!table) {
    return `Unknown table "${tableName}". Tables: ${names.join(", ")}`;
  }

  const sections = [`${tableName}`, ...table.columns.map((column) => `  ${column}`)];

  if (table.constraints.length) {
    sections.push("constraints:", ...table.constraints.map((constraint) => `  ${constraint}`));
  }

  if (table.indexes.length) {
    sections.push("indexes:", ...table.indexes.map((index) => `  ${index}`));
  }

  return sections.join("\n");
}

module.exports = { parseSchema, describeSchema };
