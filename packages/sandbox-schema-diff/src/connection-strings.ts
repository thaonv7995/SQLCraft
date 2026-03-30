/** Build a postgres connection string for sandbox introspection (PostgreSQL only). */
export function buildPostgresSandboxConnectionString(params: {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}): string {
  const user = encodeURIComponent(params.user);
  const password = encodeURIComponent(params.password);
  return `postgresql://${user}:${password}@${params.host}:${params.port}/${params.database}`;
}
