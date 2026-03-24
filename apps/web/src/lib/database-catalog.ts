import type { Database, DatabaseDomain, DatabaseScale } from './api';

export const DATABASE_DOMAIN_LABELS: Record<DatabaseDomain, string> = {
  ecommerce: 'E-Commerce',
  fintech: 'Fintech',
  health: 'Health Systems',
  iot: 'IoT Core',
  social: 'Social',
  analytics: 'Analytics',
  other: 'General',
};

export const DATABASE_SCALE_LABELS: Record<DatabaseScale, string> = {
  tiny: '100 rows',
  small: '10K rows',
  medium: '1M-5M rows',
  large: '10M+ rows',
};

export const DATABASE_DOMAIN_OPTIONS = [
  { value: 'all', label: 'All Domains' },
  { value: 'ecommerce', label: 'E-Commerce' },
  { value: 'fintech', label: 'Fintech' },
  { value: 'health', label: 'Health Systems' },
  { value: 'iot', label: 'IoT Core' },
  { value: 'social', label: 'Social' },
  { value: 'analytics', label: 'Analytics' },
];

export const DATABASE_SCALE_OPTIONS = [
  { value: 'all', label: 'Any Scale' },
  { value: 'tiny', label: 'Tiny' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
];

export const DATABASE_DIFFICULTY_STYLES: Record<
  string,
  { badge: string; label: string; accent: string }
> = {
  beginner: {
    badge: 'bg-secondary/10 text-secondary',
    label: 'Novice',
    accent: 'border-secondary/35',
  },
  intermediate: {
    badge: 'bg-primary/10 text-primary',
    label: 'Intermediate',
    accent: 'border-primary/35',
  },
  advanced: {
    badge: 'bg-error/10 text-error',
    label: 'Advanced',
    accent: 'border-error/35',
  },
};

export const PLACEHOLDER_DATABASES: Database[] = [
  {
    id: '1',
    name: 'E-Commerce Global V4',
    slug: 'ecommerce-global-v4',
    description:
      'Full-scale retail platform with orders, inventory, customers, and real-time analytics pipelines across 14 normalized tables.',
    domain: 'ecommerce',
    scale: 'large',
    difficulty: 'intermediate',
    engine: 'PostgreSQL 16',
    domainIcon: 'storefront',
    tags: ['Orders', 'Inventory', 'Analytics'],
    rowCount: 4_200_000,
    tableCount: 14,
    estimatedSizeGb: 8.4,
    region: 'us-east-1',
    uptime: 99.9,
    schema: [
      {
        name: 'customers',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'email', type: 'varchar(255)' },
          { name: 'segment', type: 'varchar(32)' },
          { name: 'created_at', type: 'timestamp' },
        ],
      },
      {
        name: 'orders',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'customer_id', type: 'uuid', isForeign: true, references: 'customers.id' },
          { name: 'status', type: 'varchar(32)' },
          { name: 'submitted_at', type: 'timestamp' },
        ],
      },
      {
        name: 'order_items',
        role: 'junction',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'order_id', type: 'uuid', isForeign: true, references: 'orders.id' },
          { name: 'product_id', type: 'uuid', isForeign: true, references: 'products.id' },
          { name: 'quantity', type: 'integer' },
        ],
      },
      {
        name: 'products',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'sku', type: 'varchar(64)' },
          { name: 'category_id', type: 'uuid', isForeign: true, references: 'categories.id' },
          { name: 'price', type: 'numeric(10,2)' },
        ],
      },
      {
        name: 'categories',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'name', type: 'varchar(120)' },
          { name: 'parent_id', type: 'uuid', isForeign: true, references: 'categories.id' },
          { name: 'depth', type: 'smallint' },
        ],
      },
      {
        name: 'shipment_events',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'order_id', type: 'uuid', isForeign: true, references: 'orders.id' },
          { name: 'event_type', type: 'varchar(32)' },
          { name: 'event_time', type: 'timestamp' },
        ],
      },
    ],
    relationships: [
      { from: 'customers', to: 'orders', label: '1:n' },
      { from: 'orders', to: 'order_items', label: '1:n' },
      { from: 'products', to: 'order_items', label: '1:n' },
      { from: 'categories', to: 'products', label: '1:n' },
      { from: 'orders', to: 'shipment_events', label: '1:n' },
    ],
  },
  {
    id: '2',
    name: 'FinTech Ledger Core',
    slug: 'fintech-ledger-core',
    description:
      'Double-entry accounting ledger with multi-currency support, fraud signals, and regulatory reporting tables.',
    domain: 'fintech',
    scale: 'medium',
    difficulty: 'advanced',
    engine: 'PostgreSQL 15',
    domainIcon: 'account_balance',
    tags: ['Ledger', 'Fraud', 'Compliance'],
    rowCount: 890_000,
    tableCount: 9,
    estimatedSizeGb: 2.1,
    region: 'eu-west-1',
    uptime: 99.99,
    schema: [
      {
        name: 'accounts',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'owner_id', type: 'uuid' },
          { name: 'currency', type: 'char(3)' },
          { name: 'status', type: 'varchar(24)' },
        ],
      },
      {
        name: 'ledger_entries',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'account_id', type: 'uuid', isForeign: true, references: 'accounts.id' },
          { name: 'transaction_id', type: 'uuid', isForeign: true, references: 'transactions.id' },
          { name: 'amount_minor', type: 'bigint' },
        ],
      },
      {
        name: 'transactions',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'merchant_id', type: 'uuid', isForeign: true, references: 'merchants.id' },
          { name: 'state', type: 'varchar(24)' },
          { name: 'booked_at', type: 'timestamp' },
        ],
      },
      {
        name: 'fraud_signals',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'transaction_id', type: 'uuid', isForeign: true, references: 'transactions.id' },
          { name: 'rule_name', type: 'varchar(80)' },
          { name: 'score', type: 'numeric(5,2)' },
        ],
      },
      {
        name: 'merchants',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'name', type: 'varchar(120)' },
          { name: 'country_code', type: 'char(2)' },
          { name: 'risk_tier', type: 'smallint' },
        ],
      },
    ],
    relationships: [
      { from: 'accounts', to: 'ledger_entries', label: '1:n' },
      { from: 'transactions', to: 'ledger_entries', label: '1:n' },
      { from: 'transactions', to: 'fraud_signals', label: '1:n' },
      { from: 'merchants', to: 'transactions', label: '1:n' },
    ],
  },
  {
    id: '3',
    name: 'Health Systems EHR',
    slug: 'health-systems-ehr',
    description:
      'Electronic health record schema with patients, encounters, diagnoses, prescriptions, and FHIR-compatible views.',
    domain: 'health',
    scale: 'medium',
    difficulty: 'intermediate',
    engine: 'PostgreSQL 16',
    domainIcon: 'health_and_safety',
    tags: ['Patients', 'EHR', 'FHIR'],
    rowCount: 560_000,
    tableCount: 11,
    estimatedSizeGb: 1.8,
    region: 'ap-southeast-1',
    uptime: 99.95,
    schema: [
      {
        name: 'patients',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'mrn', type: 'varchar(32)' },
          { name: 'birth_date', type: 'date' },
          { name: 'gender', type: 'varchar(16)' },
        ],
      },
      {
        name: 'encounters',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'patient_id', type: 'uuid', isForeign: true, references: 'patients.id' },
          { name: 'provider_id', type: 'uuid', isForeign: true, references: 'providers.id' },
          { name: 'admitted_at', type: 'timestamp' },
        ],
      },
      {
        name: 'diagnoses',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'encounter_id', type: 'uuid', isForeign: true, references: 'encounters.id' },
          { name: 'icd10_code', type: 'varchar(12)' },
          { name: 'severity', type: 'smallint' },
        ],
      },
      {
        name: 'prescriptions',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'encounter_id', type: 'uuid', isForeign: true, references: 'encounters.id' },
          { name: 'rxnorm_code', type: 'varchar(32)' },
          { name: 'dosage_text', type: 'varchar(255)' },
        ],
      },
      {
        name: 'providers',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'name', type: 'varchar(120)' },
          { name: 'specialty', type: 'varchar(120)' },
          { name: 'facility_id', type: 'uuid' },
        ],
      },
    ],
    relationships: [
      { from: 'patients', to: 'encounters', label: '1:n' },
      { from: 'providers', to: 'encounters', label: '1:n' },
      { from: 'encounters', to: 'diagnoses', label: '1:n' },
      { from: 'encounters', to: 'prescriptions', label: '1:n' },
    ],
  },
  {
    id: '4',
    name: 'IoT Sensor Stream',
    slug: 'iot-sensor-stream',
    description:
      'Time-series sensor readings from 2,400 edge devices with aggregation tables, anomaly logs, and device metadata.',
    domain: 'iot',
    scale: 'large',
    difficulty: 'advanced',
    engine: 'TimescaleDB',
    domainIcon: 'sensors',
    tags: ['Time-series', 'Sensors', 'Aggregations'],
    rowCount: 28_000_000,
    tableCount: 7,
    estimatedSizeGb: 42,
    region: 'us-west-2',
    uptime: 99.97,
    schema: [
      {
        name: 'device_registry',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'site_id', type: 'uuid' },
          { name: 'firmware_version', type: 'varchar(32)' },
          { name: 'installed_at', type: 'timestamp' },
        ],
      },
      {
        name: 'sensor_readings',
        role: 'primary',
        columns: [
          { name: 'bucket_ts', type: 'timestamp', isPrimary: true },
          { name: 'device_id', type: 'uuid', isForeign: true, references: 'device_registry.id' },
          { name: 'metric_name', type: 'varchar(48)' },
          { name: 'metric_value', type: 'double precision' },
        ],
      },
      {
        name: 'rollup_hourly',
        role: 'secondary',
        columns: [
          { name: 'bucket_ts', type: 'timestamp', isPrimary: true },
          { name: 'device_id', type: 'uuid', isForeign: true, references: 'device_registry.id' },
          { name: 'avg_value', type: 'double precision' },
          { name: 'p99_value', type: 'double precision' },
        ],
      },
      {
        name: 'anomaly_events',
        role: 'secondary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'device_id', type: 'uuid', isForeign: true, references: 'device_registry.id' },
          { name: 'signal_name', type: 'varchar(48)' },
          { name: 'triggered_at', type: 'timestamp' },
        ],
      },
    ],
    relationships: [
      { from: 'device_registry', to: 'sensor_readings', label: '1:n' },
      { from: 'device_registry', to: 'rollup_hourly', label: '1:n' },
      { from: 'device_registry', to: 'anomaly_events', label: '1:n' },
    ],
  },
  {
    id: '5',
    name: 'Social Graph Lite',
    slug: 'social-graph-lite',
    description:
      'Minimal social network with users, posts, likes, follows, and feed ranking signals. Great for window functions.',
    domain: 'social',
    scale: 'small',
    difficulty: 'beginner',
    engine: 'PostgreSQL 15',
    domainIcon: 'group',
    tags: ['Graph', 'Feed', 'Ranking'],
    rowCount: 95_000,
    tableCount: 8,
    estimatedSizeGb: 0.3,
    region: 'sa-east-1',
    uptime: 99.7,
    schema: [
      {
        name: 'users',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'handle', type: 'varchar(32)' },
          { name: 'joined_at', type: 'timestamp' },
          { name: 'country_code', type: 'char(2)' },
        ],
      },
      {
        name: 'posts',
        role: 'primary',
        columns: [
          { name: 'id', type: 'uuid', isPrimary: true },
          { name: 'author_id', type: 'uuid', isForeign: true, references: 'users.id' },
          { name: 'body', type: 'text' },
          { name: 'created_at', type: 'timestamp' },
        ],
      },
      {
        name: 'follows',
        role: 'junction',
        columns: [
          { name: 'follower_id', type: 'uuid', isForeign: true, references: 'users.id' },
          { name: 'followed_id', type: 'uuid', isForeign: true, references: 'users.id' },
          { name: 'created_at', type: 'timestamp' },
          { name: 'muted', type: 'boolean' },
        ],
      },
      {
        name: 'reactions',
        role: 'junction',
        columns: [
          { name: 'user_id', type: 'uuid', isForeign: true, references: 'users.id' },
          { name: 'post_id', type: 'uuid', isForeign: true, references: 'posts.id' },
          { name: 'reaction_type', type: 'varchar(16)' },
          { name: 'created_at', type: 'timestamp' },
        ],
      },
    ],
    relationships: [
      { from: 'users', to: 'posts', label: '1:n' },
      { from: 'users', to: 'follows', label: 'm:n' },
      { from: 'users', to: 'reactions', label: '1:n' },
      { from: 'posts', to: 'reactions', label: '1:n' },
    ],
  },
  {
    id: '6',
    name: 'Analytics Warehouse',
    slug: 'analytics-warehouse',
    description:
      'Star-schema data warehouse with fact tables, dimensions, and materialized rollups. Optimized for analytical SQL.',
    domain: 'analytics',
    scale: 'large',
    difficulty: 'advanced',
    engine: 'PostgreSQL 16',
    domainIcon: 'bar_chart',
    tags: ['Star Schema', 'OLAP', 'Rollups'],
    rowCount: 6_500_000,
    tableCount: 18,
    estimatedSizeGb: 14.2,
    region: 'us-central-1',
    uptime: 99.98,
    schema: [
      {
        name: 'fact_orders',
        role: 'primary',
        columns: [
          { name: 'order_key', type: 'bigint', isPrimary: true },
          { name: 'customer_key', type: 'bigint', isForeign: true, references: 'dim_customers.customer_key' },
          { name: 'date_key', type: 'integer', isForeign: true, references: 'dim_dates.date_key' },
          { name: 'gross_revenue', type: 'numeric(14,2)' },
        ],
      },
      {
        name: 'dim_customers',
        role: 'secondary',
        columns: [
          { name: 'customer_key', type: 'bigint', isPrimary: true },
          { name: 'segment', type: 'varchar(32)' },
          { name: 'region_name', type: 'varchar(64)' },
          { name: 'lifetime_value_band', type: 'varchar(24)' },
        ],
      },
      {
        name: 'dim_dates',
        role: 'secondary',
        columns: [
          { name: 'date_key', type: 'integer', isPrimary: true },
          { name: 'calendar_date', type: 'date' },
          { name: 'week_of_year', type: 'smallint' },
          { name: 'fiscal_period', type: 'varchar(16)' },
        ],
      },
      {
        name: 'mv_revenue_daily',
        role: 'secondary',
        columns: [
          { name: 'calendar_date', type: 'date', isPrimary: true },
          { name: 'segment', type: 'varchar(32)' },
          { name: 'revenue_total', type: 'numeric(14,2)' },
          { name: 'orders_total', type: 'integer' },
        ],
      },
    ],
    relationships: [
      { from: 'dim_customers', to: 'fact_orders', label: '1:n' },
      { from: 'dim_dates', to: 'fact_orders', label: '1:n' },
    ],
  },
];

export function getFallbackDatabase(idOrSlug: string): Database | undefined {
  return PLACEHOLDER_DATABASES.find(
    (database) => database.id === idOrSlug || database.slug === idOrSlug,
  );
}
