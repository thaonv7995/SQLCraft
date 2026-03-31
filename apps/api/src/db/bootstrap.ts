import 'dotenv/config';
import { createSeedContext, getFirstAdminConfig, seedBootstrapCore } from './seed-core';

async function bootstrap() {
  const { pool, db } = createSeedContext();

  console.log('Bootstrapping database...');
  const { firstAdmin } = await seedBootstrapCore(db);

  console.log('\nBootstrap completed successfully!');
  console.log('First admin credentials:');
  console.log(`  email: ${firstAdmin.email}`);
  console.log(`  username: ${firstAdmin.username}`);
  console.log(`  password: ${firstAdmin.password}`);

  await pool.end();
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed:', err);
  process.exit(1);
});
