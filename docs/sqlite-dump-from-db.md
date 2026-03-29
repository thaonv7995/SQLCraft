# Importing data from a SQLite `.db` file

SQLCraft’s upload pipeline expects **text SQL** (`.sql`, `.txt`, `.sql.gz`, or `.zip` containing `.sql`). **Binary SQLite database files (`.db`, `.sqlite`, …) are not accepted.**

## Recommended: export SQL on your machine

With the [SQLite CLI](https://www.sqlite.org/cli.html) installed:

```bash
sqlite3 path/to/app.db .dump > app.sql
```

Then upload `app.sql`, or compress first:

```bash
gzip -c app.sql > app.sql.gz
```

On **Windows** (if `sqlite3.exe` is on your `PATH`):

```powershell
sqlite3.exe path\to\app.db .dump > app.sql
```

GUI tools (DB Browser for SQLite, DBeaver, etc.) usually have **File → Export → SQL** or similar.

## Dialect caveat

`.dump` output is **SQLite-flavored SQL**. If your lab sandbox uses **PostgreSQL**, **MySQL/MariaDB**, or **SQL Server**, some statements may not run as-is. You may need to edit types, quotes, or vendor-specific syntax—or choose a template whose dialect matches how you intend to use the data.

## Why not upload `.db` here?

The platform scans and stores a **canonical SQL artifact** for Docker-based sandboxes. Supporting raw `.db` would require a separate SQLite runtime path (see product discussion in issues/docs), which is outside the current import flow.
