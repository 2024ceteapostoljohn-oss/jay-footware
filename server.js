require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');

/* ---------------------------------------------------------
   Server-side validation helpers
   --------------------------------------------------------- */

const PH_MOBILE_E164 = /^\+639\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF'\-.\s]+$/;

const isBlankField = v =>
  typeof v !== 'string' || v.trim().length === 0;

function isValidEmail(value) {
  const email = String(value || '').trim();

  if (email.length > 254 || !EMAIL_RE.test(email)) {
    return false;
  }

  const parts = email.split('@');

  if (parts.length !== 2) {
    return false;
  }

  const [local, domain] = parts;

  if (
    !local ||
    local.length > 64 ||
    local.startsWith('.') ||
    local.endsWith('.') ||
    local.includes('..')
  ) {
    return false;
  }

  if (
    domain.startsWith('.') ||
    domain.endsWith('.') ||
    domain.includes('..')
  ) {
    return false;
  }

  return !/\s/.test(email);
}

function normalizePhPhone(value) {
  if (isBlankField(value)) {
    return null;
  }

  let p = String(value)
    .trim()
    .replace(/[\s\-\.\(\)]/g, '');

  if (/^0/.test(p)) {
    p = '+63' + p.slice(1);
  } else if (/^63/.test(p)) {
    p = '+' + p;
  } else if (/^9/.test(p) && p.length === 10) {
    p = '+63' + p;
  }

  return PH_MOBILE_E164.test(p) ? p : null;
}

function ageFromDateOfBirth(value) {
  const date = new Date(String(value));

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const today = new Date();

  if (date > today) {
    return null;
  }

  if (
    String(value).length !== 10 &&
    !String(value).match(/^\d{4}-\d{2}-\d{2}$/)
  ) {
    return null;
  }

  let age = today.getFullYear() - date.getFullYear();

  const m = today.getMonth() - date.getMonth();

  if (
    m < 0 ||
    (m === 0 && today.getDate() < date.getDate())
  ) {
    age--;
  }

  return age >= 0 && age <= 120 ? age : null;
}

function isStrongPassword(pw) {
  if (
    typeof pw !== 'string' ||
    pw.length < 12 ||
    pw.length > 128
  ) {
    return false;
  }

  if (!/[A-Z]/.test(pw)) return false;
  if (!/[a-z]/.test(pw)) return false;
  if (!/[0-9]/.test(pw)) return false;
  if (!/[^A-Za-z0-9]/.test(pw)) return false;

  return true;
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidName(value) {
  const name = normalizeName(value);

  return (
    name.length > 0 &&
    name.length <= 80 &&
    NAME_RE.test(name)
  );
}

/* ---------------------------------------------------------
   Express application
   --------------------------------------------------------- */

const app = express();

const PORT = process.env.PORT || 3000;

const db = new Database(
  path.join(__dirname, 'data', 'jay-footwear.db')
);

db.pragma('foreign_keys = ON');

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID
);

app.use(
  helmet({
    contentSecurityPolicy: false
  })
);

app.use(
  express.json({
    limit: '100kb'
  })
);

app.use(
  express.urlencoded({
    extended: false
  })
);

app.use(
  session({
    secret:
      process.env.SESSION_SECRET ||
      'change-this-development-secret',

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure:
        process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(
  express.static(
    path.join(__dirname, 'public')
  )
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false
});

/* ---------------------------------------------------------
   GMAIL / NODEMAILER
   --------------------------------------------------------- */

const mailer = nodemailer.createTransport({
  service: 'gmail',

  auth: {
    user: process.env.EMAIL_USER,

    pass: String(
      process.env.EMAIL_APP_PASSWORD || ''
    ).replace(/\s+/g, '')
  }
});

/*
   Verify Gmail configuration when the server starts.
   This does NOT stop the server if email configuration
   is missing, so the rest of the website can still run.
*/

if (
  process.env.EMAIL_USER &&
  process.env.EMAIL_APP_PASSWORD
) {
  mailer.verify((error) => {
    if (error) {
      console.error(
        'Gmail SMTP verification failed:',
        error.message
      );
    } else {
      console.log(
        'Gmail SMTP is ready for email verification.'
      );
    }
  });
} else {
  console.warn(
    'EMAIL_USER or EMAIL_APP_PASSWORD is missing from .env'
  );
}

/* ---------------------------------------------------------
   EMAIL VERIFICATION EMAIL
   --------------------------------------------------------- */

async function sendVerificationEmail({
  email,
  firstName,
  token
}) {
  const baseUrl =
    String(
      process.env.BASE_URL ||
      `http://localhost:${PORT}`
    ).replace(/\/$/, '');

  const verificationUrl =
    `${baseUrl}/api/auth/verify-email?token=${encodeURIComponent(token)}`;

  const safeFirstName =
    String(firstName || 'Customer')
      .replace(/[<>&"]/g, '');

  const mailOptions = {
    from:
      `"Jay Footwear" <${process.env.EMAIL_USER}>`,

    to: email,

    subject:
      'Verify your Jay Footwear email address',

    text:
`Hello ${safeFirstName},

Thank you for creating your Jay Footwear account.

Please verify your email address by opening this link:

${verificationUrl}

This verification link will expire in 24 hours.

If you did not create this account, you can ignore this email.

Jay Footwear`,

    html:
`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verify your Jay Footwear account</title>
</head>

<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif;">

  <div style="max-width:600px;margin:40px auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">

    <div style="background:#111111;padding:24px;text-align:center;">
      <h1 style="margin:0;color:#ffffff;font-size:28px;">
        JAY FOOTWEAR
      </h1>
    </div>

    <div style="padding:36px 30px;">

      <h2 style="margin-top:0;color:#111111;">
        Verify your email
      </h2>

      <p style="color:#444444;font-size:16px;line-height:1.6;">
        Hello ${safeFirstName},
      </p>

      <p style="color:#444444;font-size:16px;line-height:1.6;">
        Thank you for creating your Jay Footwear account.
        Please click the button below to verify your email address.
      </p>

      <div style="text-align:center;margin:32px 0;">

        <a
          href="${verificationUrl}"
          style="
            display:inline-block;
            background:#e31b23;
            color:#ffffff;
            text-decoration:none;
            padding:14px 28px;
            border-radius:6px;
            font-weight:bold;
            font-size:16px;
          "
        >
          Verify My Email
        </a>

      </div>

      <p style="color:#666666;font-size:14px;line-height:1.6;">
        This verification link will expire in 24 hours.
      </p>

      <p style="color:#666666;font-size:14px;line-height:1.6;">
        If you did not create a Jay Footwear account,
        you can safely ignore this email.
      </p>

      <hr style="border:none;border-top:1px solid #eeeeee;margin:30px 0;">

      <p style="color:#999999;font-size:12px;line-height:1.5;">
        Jay Footwear<br>
        Pre-loved. Re-stepped.
      </p>

    </div>

  </div>

</body>
</html>`
  };

  return mailer.sendMail(mailOptions);
}

/* ---------------------------------------------------------
   DATABASE
   --------------------------------------------------------- */

function initDatabase() {

  db.exec(`
    CREATE TABLE IF NOT EXISTS role (
      role_id INTEGER PRIMARY KEY,
      role_name TEXT UNIQUE NOT NULL,
      role_description TEXT
    );

    CREATE TABLE IF NOT EXISTS customer (
      customer_id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      phone_number TEXT,
      email_address TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_address (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL,
      address_type TEXT,
      house_street TEXT,
      barangay TEXT,
      city TEXT NOT NULL,
      province TEXT NOT NULL,
      postal_code TEXT,
      FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_account (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT,
      customer_id INTEGER,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Active',
      google_id TEXT UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,

      email_verified INTEGER NOT NULL DEFAULT 0,
      verification_token TEXT,
      verification_expires_at INTEGER,

      FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id)
        ON DELETE SET NULL,

      FOREIGN KEY (role_id)
        REFERENCES role(role_id)
    );

    CREATE TABLE IF NOT EXISTS supplier (
      supplier_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_name TEXT UNIQUE NOT NULL,
      contact_person TEXT,
      phone_number TEXT,
      email_address TEXT,
      supplier_status TEXT
    );

    CREATE TABLE IF NOT EXISTS supplier_address (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      house_street TEXT,
      barangay TEXT,
      city TEXT,
      province TEXT,
      postal_code TEXT,

      FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS category (
      category_id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_name TEXT UNIQUE NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS brand (
      brand_id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT UNIQUE NOT NULL,
      country_of_origin TEXT
    );

    CREATE TABLE IF NOT EXISTS product_condition (
      condition_id INTEGER PRIMARY KEY AUTOINCREMENT,
      condition_name TEXT UNIQUE NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shoe_size (
      size_id INTEGER PRIMARY KEY AUTOINCREMENT,
      size_system TEXT NOT NULL,
      size_value REAL NOT NULL,
      UNIQUE(size_system, size_value)
    );

    CREATE TABLE IF NOT EXISTS payment_method (
      method_id INTEGER PRIMARY KEY AUTOINCREMENT,
      method_name TEXT UNIQUE NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS product (
      product_id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_name TEXT NOT NULL,
      category_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL,
      condition_id INTEGER NOT NULL,
      selling_price REAL NOT NULL
        CHECK(selling_price >= 0),
      image_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,

      FOREIGN KEY (category_id)
        REFERENCES category(category_id),

      FOREIGN KEY (brand_id)
        REFERENCES brand(brand_id),

      FOREIGN KEY (condition_id)
        REFERENCES product_condition(condition_id),

      UNIQUE(product_name, brand_id)
    );

    CREATE TABLE IF NOT EXISTS product_variant (
      variant_id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      size_id INTEGER NOT NULL,
      sku TEXT UNIQUE NOT NULL,

      FOREIGN KEY (product_id)
        REFERENCES product(product_id)
        ON DELETE CASCADE,

      FOREIGN KEY (size_id)
        REFERENCES shoe_size(size_id),

      UNIQUE(product_id, size_id)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      variant_id INTEGER PRIMARY KEY,
      stock_quantity INTEGER NOT NULL DEFAULT 0
        CHECK(stock_quantity >= 0),

      reorder_level INTEGER NOT NULL DEFAULT 1,

      last_updated TEXT
        DEFAULT CURRENT_TIMESTAMP,

      FOREIGN KEY (variant_id)
        REFERENCES product_variant(variant_id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sales_transaction (
      sale_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER NOT NULL,
      customer_id INTEGER,
      order_discount REAL NOT NULL DEFAULT 0,
      sale_status TEXT NOT NULL,

      FOREIGN KEY (user_id)
        REFERENCES user_account(user_id),

      FOREIGN KEY (customer_id)
        REFERENCES customer(customer_id)
        ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS sales_item (
      sale_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_discount REAL NOT NULL DEFAULT 0,

      FOREIGN KEY (sale_id)
        REFERENCES sales_transaction(sale_id)
        ON DELETE CASCADE,

      FOREIGN KEY (variant_id)
        REFERENCES product_variant(variant_id),

      UNIQUE(sale_id, variant_id)
    );

    CREATE TABLE IF NOT EXISTS payment (
      payment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      method_id INTEGER NOT NULL,
      payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      amount_paid REAL NOT NULL CHECK(amount_paid >= 0),
      reference_number TEXT,
      payment_status TEXT NOT NULL,

      FOREIGN KEY (sale_id)
        REFERENCES sales_transaction(sale_id),

      FOREIGN KEY (method_id)
        REFERENCES payment_method(method_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order (
      purchase_order_id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      order_date TEXT NOT NULL,
      expected_date TEXT,
      received_date TEXT,
      po_status TEXT NOT NULL,

      FOREIGN KEY (supplier_id)
        REFERENCES supplier(supplier_id),

      FOREIGN KEY (user_id)
        REFERENCES user_account(user_id)
    );

    CREATE TABLE IF NOT EXISTS purchase_order_item (
      purchase_order_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL,
      quantity_ordered INTEGER NOT NULL,
      quantity_received INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL,

      FOREIGN KEY (purchase_order_id)
        REFERENCES purchase_order(purchase_order_id)
        ON DELETE CASCADE,

      FOREIGN KEY (variant_id)
        REFERENCES product_variant(variant_id),

      UNIQUE(purchase_order_id, variant_id)
    );
  `);

  /* -------------------------------------------------------
     Database migrations
     ------------------------------------------------------- */

  const productColumns =
    db.prepare(
      'PRAGMA table_info(product)'
    ).all().map(column => column.name);

  if (!productColumns.includes('image_path')) {
    db.exec(
      'ALTER TABLE product ADD COLUMN image_path TEXT'
    );
  }

  const customerColumns =
    db.prepare(
      'PRAGMA table_info(customer)'
    ).all().map(column => column.name);

  if (!customerColumns.includes('middle_name')) {
    db.exec(
      'ALTER TABLE customer ADD COLUMN middle_name TEXT'
    );
  }

  if (!customerColumns.includes('suffix')) {
    db.exec(
      'ALTER TABLE customer ADD COLUMN suffix TEXT'
    );
  }

  if (!customerColumns.includes('date_of_birth')) {
    db.exec(
      'ALTER TABLE customer ADD COLUMN date_of_birth TEXT'
    );
  }

  if (!customerColumns.includes('gender')) {
    db.exec(
      'ALTER TABLE customer ADD COLUMN gender TEXT'
    );
  }

  const addressColumns =
    db.prepare(
      'PRAGMA table_info(customer_address)'
    ).all().map(column => column.name);

  if (!addressColumns.includes('region')) {
    db.exec(
      'ALTER TABLE customer_address ADD COLUMN region TEXT'
    );
  }

  if (!addressColumns.includes('street')) {
    db.exec(
      'ALTER TABLE customer_address ADD COLUMN street TEXT'
    );
  }

  /*
     EMAIL VERIFICATION MIGRATION

     This is important if your existing jay-footwear.db
     already exists.
  */

  const userColumns =
    db.prepare(
      'PRAGMA table_info(user_account)'
    ).all().map(column => column.name);

  if (!userColumns.includes('email_verified')) {
    db.exec(
      'ALTER TABLE user_account ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0'
    );
  }

  if (!userColumns.includes('verification_token')) {
    db.exec(
      'ALTER TABLE user_account ADD COLUMN verification_token TEXT'
    );
  }

  if (!userColumns.includes('verification_expires_at')) {
    db.exec(
      'ALTER TABLE user_account ADD COLUMN verification_expires_at INTEGER'
    );
  }

  /* -------------------------------------------------------
     Roles
     ------------------------------------------------------- */

  db.prepare(
    'INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (1,?,?)'
  ).run(
    'Admin',
    'Full system access'
  );

  db.prepare(
    'INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (2,?,?)'
  ).run(
    'Customer',
    'Store customer account'
  );

  db.prepare(
    'INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (3,?,?)'
  ).run(
    'Cashier',
    'Sales and payment processing'
  );

  db.prepare(
    'INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (4,?,?)'
  ).run(
    'Owner/Manager',
    'Business reports and performance monitoring'
  );

  /* -------------------------------------------------------
     Admin
     ------------------------------------------------------- */

  const adminHash = bcrypt.hashSync(
    process.env.ADMIN_PASSWORD || 'Yojinn',
    12
  );

  db.prepare(`
    INSERT OR IGNORE INTO user_account
    (
      username,
      password_hash,
      first_name,
      last_name,
      role_id,
      email_verified
    )
    VALUES (?,?,?,?,1,1)
  `).run(
    'admin',
    adminHash,
    'Jay Footwear',
    'Admin'
  );

  /* -------------------------------------------------------
     Cashiers
     ------------------------------------------------------- */

  const cashierHash = bcrypt.hashSync(
    process.env.CASHIER_PASSWORD || 'Cashier123!',
    12
  );

  const cashiers = [
    ['cashier1', 'Yojin', 'Apostol'],
    ['cashier2', 'Najeeb', 'Sultan'],
    ['cashier3', 'Kenneth', 'Abram'],
    ['cashier4', 'Carlo', 'Mendoza'],
    ['cashier5', 'Bea', 'Navarro']
  ];

  const addCashier = db.prepare(`
    INSERT OR IGNORE INTO user_account
    (
      username,
      password_hash,
      first_name,
      last_name,
      role_id,
      account_status,
      email_verified
    )
    VALUES (?,?,?,?,3,'Active',1)
  `);

  cashiers.forEach(row => {
    addCashier.run(
      row[0],
      cashierHash,
      row[1],
      row[2]
    );
  });

  /* -------------------------------------------------------
     Owner
     ------------------------------------------------------- */

  const ownerHash = bcrypt.hashSync(
    process.env.OWNER_PASSWORD || 'Owner123!',
    12
  );

  db.prepare(`
    INSERT OR IGNORE INTO user_account
    (
      username,
      password_hash,
      first_name,
      last_name,
      role_id,
      account_status,
      email_verified
    )
    VALUES (?,?,?,?,4,'Active',1)
  `).run(
    'owner',
    ownerHash,
    'Jay Footwear',
    'Owner'
  );

  /* -------------------------------------------------------
     Categories
     ------------------------------------------------------- */

  [
    'Sneakers',
    'Skate Shoes',
    'Lifestyle Shoes'
  ].forEach((name, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO category
      (
        category_id,
        category_name,
        description
      )
      VALUES (?,?,?)
    `).run(
      i + 1,
      name,
      'Pre-loved ukay-ukay footwear'
    );

  });

  /* -------------------------------------------------------
     Brands
     ------------------------------------------------------- */

  const brands = [
    ['Nike', 'United States'],
    ['Vans', 'United States'],
    ['Adidas', 'Germany'],
    ['Converse', 'United States'],
    ['Reebok', 'United Kingdom'],
    ['New Balance', 'United States']
  ];

  brands.forEach((r, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO brand
      (
        brand_id,
        brand_name,
        country_of_origin
      )
      VALUES (?,?,?)
    `).run(
      i + 1,
      ...r
    );

  });

  /* -------------------------------------------------------
     Conditions
     ------------------------------------------------------- */

  [
    'Excellent',
    'Very Good',
    'Good'
  ].forEach((name, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO product_condition
      (
        condition_id,
        condition_name
      )
      VALUES (?,?)
    `).run(
      i + 1,
      name
    );

  });

  /* -------------------------------------------------------
     Sizes
     ------------------------------------------------------- */

  [
    9,
    8,
    10,
    7,
    9.5,
    8.5
  ].forEach((size, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO shoe_size
      (
        size_id,
        size_system,
        size_value
      )
      VALUES (?,?,?)
    `).run(
      i + 1,
      'US',
      size
    );

  });

  /* -------------------------------------------------------
     Payment methods
     ------------------------------------------------------- */

  [
    ['Cash on Delivery', 1],
    ['GCash', 1],
    ['Bank Transfer', 1]
  ].forEach((r, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO payment_method
      (
        method_id,
        method_name,
        is_active
      )
      VALUES (?,?,?)
    `).run(
      i + 1,
      ...r
    );

  });

  /* -------------------------------------------------------
     Products
     ------------------------------------------------------- */

  const products = [
    [
      'Air Max 90',
      1,
      1,
      1,
      1850,
      'JF-001',
      1,
      1,
      'images/products/air-max-90.jpg'
    ],
    [
      'Old Skool',
      2,
      2,
      2,
      1200,
      'JF-002',
      2,
      2,
      'images/products/old-skool.jpg'
    ],
    [
      'Superstar',
      1,
      3,
      3,
      1450,
      'JF-003',
      3,
      1,
      'images/products/superstar.jpg'
    ],
    [
      'Chuck 70 High',
      1,
      4,
      1,
      1650,
      'JF-004',
      4,
      1,
      'images/products/chuck-70-high.jpg'
    ],
    [
      'Classic Leather',
      3,
      5,
      2,
      1350,
      'JF-005',
      5,
      3,
      'images/products/classic-leather.jpg'
    ],
    [
      '574 Core',
      3,
      6,
      3,
      1550,
      'JF-006',
      6,
      1,
      'images/products/574-core.jpg'
    ]
  ];

  const seedProduct = db.transaction(row => {

    const [
      name,
      categoryId,
      brandId,
      conditionId,
      price,
      sku,
      sizeId,
      stock,
      imagePath
    ] = row;

    let product = db.prepare(`
      SELECT product_id
      FROM product
      WHERE product_name=?
      AND brand_id=?
      ORDER BY product_id
      LIMIT 1
    `).get(
      name,
      brandId
    );

    if (!product) {

      const result = db.prepare(`
        INSERT INTO product
        (
          product_name,
          category_id,
          brand_id,
          condition_id,
          selling_price,
          image_path
        )
        VALUES (?,?,?,?,?,?)
      `).run(
        name,
        categoryId,
        brandId,
        conditionId,
        price,
        imagePath
      );

      product = {
        product_id: result.lastInsertRowid
      };

    } else {

      db.prepare(`
        UPDATE product
        SET image_path=?
        WHERE product_id=?
      `).run(
        imagePath,
        product.product_id
      );

    }

    db.prepare(`
      INSERT OR IGNORE INTO product_variant
      (
        product_id,
        size_id,
        sku
      )
      VALUES (?,?,?)
    `).run(
      product.product_id,
      sizeId,
      sku
    );

    const variant = db.prepare(`
      SELECT variant_id
      FROM product_variant
      WHERE sku=?
    `).get(sku);

    db.prepare(`
      INSERT OR IGNORE INTO inventory
      (
        variant_id,
        stock_quantity,
        reorder_level
      )
      VALUES (?,?,1)
    `).run(
      variant.variant_id,
      stock
    );

  });

  products.forEach(seedProduct);

  /* -------------------------------------------------------
     Sample customers
     ------------------------------------------------------- */

  const customers = [
    [
      'Mika',
      'Santos',
      'mika@example.com',
      'Davao City',
      'Davao del Sur',
      '2026-05-18'
    ],
    [
      'Paolo',
      'Cruz',
      'paolo@example.com',
      'Tagum City',
      'Davao del Norte',
      '2026-06-03'
    ],
    [
      'Lara',
      'Reyes',
      'lara@example.com',
      'Digos City',
      'Davao del Sur',
      '2026-06-21'
    ],
    [
      'Ken',
      'Flores',
      'ken@example.com',
      'Panabo City',
      'Davao del Norte',
      '2026-07-09'
    ],
    [
      'Ana',
      'Lim',
      'ana@example.com',
      'Cebu City',
      'Cebu',
      '2026-08-01'
    ]
  ];

  customers.forEach((r, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO customer
      (
        customer_id,
        first_name,
        last_name,
        email_address
      )
      VALUES (?,?,?,?)
    `).run(
      i + 1,
      r[0],
      r[1],
      r[2]
    );

    db.prepare(`
      INSERT OR IGNORE INTO customer_address
      (
        address_id,
        customer_id,
        address_type,
        city,
        province
      )
      VALUES (?,?, 'Shipping',?,?)
    `).run(
      i + 1,
      i + 1,
      r[3],
      r[4]
    );

  });

  const admin = db.prepare(
    "SELECT user_id FROM user_account WHERE username='admin'"
  ).get();

  /* -------------------------------------------------------
     Sample orders
     ------------------------------------------------------- */

  const orderSeed = [
    [1, 1, 'Completed', '2026-08-10', 1, 1850],
    [2, 2, 'Processing', '2026-08-11', 2, 1200],
    [3, 3, 'Shipped', '2026-08-12', 3, 1450],
    [4, 4, 'Completed', '2026-08-13', 4, 1650],
    [5, 5, 'Processing', '2026-08-14', 5, 1350]
  ];

  orderSeed.forEach((r, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO sales_transaction
      (
        sale_id,
        sale_date,
        user_id,
        customer_id,
        sale_status
      )
      VALUES (?,?,?,?,?)
    `).run(
      i + 1,
      r[3],
      admin.user_id,
      r[0],
      r[2]
    );

    db.prepare(`
      INSERT OR IGNORE INTO sales_item
      (
        sale_item_id,
        sale_id,
        variant_id,
        quantity,
        unit_price
      )
      VALUES (?,?,?,?,?)
    `).run(
      i + 1,
      i + 1,
      r[1],
      1,
      r[5]
    );

    db.prepare(`
      INSERT OR IGNORE INTO payment
      (
        payment_id,
        sale_id,
        method_id,
        payment_date,
        amount_paid,
        payment_status
      )
      VALUES (?,?,?,?,?,?)
    `).run(
      i + 1,
      i + 1,
      1,
      r[3],
      r[5],
      r[2] === 'Completed'
        ? 'Paid'
        : 'Pending'
    );

  });

  /* -------------------------------------------------------
     Suppliers
     ------------------------------------------------------- */

  const suppliers = [
    [
      'Mindanao Shoe Finds',
      'R. Garcia',
      '09170000000',
      'mindanao@example.com',
      'Davao City',
      'Davao del Sur'
    ],
    [
      'Metro Sneaker Hub',
      'L. Santos',
      '09171111111',
      'metro@example.com',
      'Makati City',
      'Metro Manila'
    ],
    [
      'Cebu Preloved Kicks',
      'J. Lim',
      '09172222222',
      'cebu@example.com',
      'Cebu City',
      'Cebu'
    ],
    [
      'North Sole Trading',
      'A. Cruz',
      '09173333333',
      'northsole@example.com',
      'Baguio City',
      'Benguet'
    ],
    [
      'South Pair Supply',
      'M. Reyes',
      '09174444444',
      'southpair@example.com',
      'General Santos City',
      'South Cotabato'
    ]
  ];

  suppliers.forEach((row, i) => {

    db.prepare(`
      INSERT OR IGNORE INTO supplier
      (
        supplier_id,
        supplier_name,
        contact_person,
        phone_number,
        email_address,
        supplier_status
      )
      VALUES (?,?,?,?,?,'Active')
    `).run(
      i + 1,
      row[0],
      row[1],
      row[2],
      row[3]
    );

    db.prepare(`
      INSERT OR IGNORE INTO supplier_address
      (
        address_id,
        supplier_id,
        city,
        province
      )
      VALUES (?,?,?,?)
    `).run(
      i + 1,
      i + 1,
      row[4],
      row[5]
    );

  });

  db.prepare(`
    INSERT OR IGNORE INTO purchase_order
    (
      purchase_order_id,
      supplier_id,
      user_id,
      order_date,
      expected_date,
      po_status
    )
    VALUES
    (1,1,?,'2026-08-01','2026-08-08','Received')
  `).run(
    admin.user_id
  );

  db.prepare(`
    INSERT OR IGNORE INTO purchase_order_item
    (
      purchase_order_item_id,
      purchase_order_id,
      variant_id,
      quantity_ordered,
      quantity_received,
      unit_cost
    )
    VALUES (1,1,1,2,2,900)
  `).run();
}

initDatabase();

/* ---------------------------------------------------------
   Queries
   --------------------------------------------------------- */

const productQuery = `
  SELECT
    pv.variant_id AS variantId,
    pv.sku,
    p.product_name AS name,
    b.brand_name AS brand,
    ss.size_system || ' ' ||
      CAST(ss.size_value AS TEXT) AS size,
    pc.condition_name AS condition,
    p.selling_price AS price,
    p.image_path AS image,
    i.stock_quantity AS stock

  FROM product p

  JOIN brand b
    ON b.brand_id=p.brand_id

  JOIN product_condition pc
    ON pc.condition_id=p.condition_id

  JOIN product_variant pv
    ON pv.product_id=p.product_id

  JOIN shoe_size ss
    ON ss.size_id=pv.size_id

  JOIN inventory i
    ON i.variant_id=pv.variant_id

  WHERE p.is_active=1

  ORDER BY p.product_id
`;

const orderQuery = `
  SELECT
    'ORD-' ||
      printf('%04d',st.sale_id+1000) AS order_no,

    COALESCE(
      c.first_name || ' ' || c.last_name,
      'Walk-in Customer'
    ) AS customer_name,

    p.product_name AS item,

    (si.quantity*si.unit_price)
      -si.line_discount
      -st.order_discount AS total,

    st.sale_status AS status,

    date(st.sale_date) AS order_date

  FROM sales_transaction st

  LEFT JOIN customer c
    ON c.customer_id=st.customer_id

  JOIN sales_item si
    ON si.sale_id=st.sale_id

  JOIN product_variant pv
    ON pv.variant_id=si.variant_id

  JOIN product p
    ON p.product_id=pv.product_id

  ORDER BY st.sale_id
`;

const customerQuery = `
  SELECT
    c.customer_id,

    'CUS-' ||
      printf('%03d',c.customer_id) AS customer_no,

    c.first_name || ' ' ||
      c.last_name AS name,

    c.email_address AS email,

    COALESCE(ca.city,'—') AS city,

    COUNT(st.sale_id) AS orders_count,

    COALESCE(
      MIN(date(st.sale_date)),
      date('now')
    ) AS joined_date

  FROM customer c

  LEFT JOIN customer_address ca
    ON ca.customer_id=c.customer_id

  LEFT JOIN sales_transaction st
    ON st.customer_id=c.customer_id

  GROUP BY c.customer_id

  ORDER BY c.customer_id
`;

const supplierQuery = `
  SELECT
    s.supplier_id,

    'SUP-' ||
      printf('%03d',s.supplier_id) AS supplier_no,

    s.supplier_name AS name,

    s.contact_person,

    s.phone_number AS contact,

    s.email_address AS email,

    COALESCE(
      sa.city || ', ' || sa.province,
      '—'
    ) AS location,

    s.supplier_status AS status

  FROM supplier s

  LEFT JOIN supplier_address sa
    ON sa.supplier_id=s.supplier_id

  ORDER BY s.supplier_id
`;

const cashierQuery = `
  SELECT
    'USR-' ||
      printf('%03d',ua.user_id) AS user_no,

    ua.username,

    ua.first_name || ' ' ||
      ua.last_name AS name,

    r.role_name AS role,

    ua.account_status AS status,

    date(ua.created_at) AS created_date

  FROM user_account ua

  JOIN role r
    ON r.role_id=ua.role_id

  WHERE r.role_name='Cashier'

  ORDER BY ua.user_id
`;

/* ---------------------------------------------------------
   Authentication helpers
   --------------------------------------------------------- */

function safeUser(row) {

  return row && {
    id: row.user_id,
    username: row.username,
    email: row.email_address || null,

    fullName:
      `${row.first_name} ${row.last_name}`.trim(),

    role:
      row.role_name.toLowerCase(),

    emailVerified:
      row.email_verified === 1
  };
}

function getUser(where, ...values) {

  return db.prepare(`
    SELECT
      ua.*,
      r.role_name,
      c.email_address

    FROM user_account ua

    JOIN role r
      ON r.role_id=ua.role_id

    LEFT JOIN customer c
      ON c.customer_id=ua.customer_id

    WHERE ${where}
  `).get(...values);
}

function requireAdmin(req, res, next) {

  if (
    !req.session.user ||
    req.session.user.role !== 'admin'
  ) {
    return res.status(403).json({
      error: 'Admin access is required.'
    });
  }

  next();
}

function requireRole(...roles) {

  return (req, res, next) => {

    if (
      !req.session.user ||
      !roles.includes(req.session.user.role)
    ) {
      return res.status(403).json({
        error:
          'You do not have permission to access this feature.'
      });
    }

    next();
  };
}

/* ---------------------------------------------------------
   Signup validation
   --------------------------------------------------------- */

function validateSignupPayload(b = {}) {

  const fields = {};

  const firstName =
    normalizeName(b.firstName);

  const middleName =
    normalizeName(b.middleName);

  const lastName =
    normalizeName(b.lastName);

  const suffix =
    normalizeName(b.suffix);

  const email =
    String(b.email || '')
      .trim()
      .toLowerCase();

  const confirmEmail =
    String(b.confirmEmail || '')
      .trim()
      .toLowerCase();

  const phone =
    String(b.phone || '').trim();

  const password =
    String(b.password || '');

  const confirmPassword =
    String(b.confirmPassword || '');

  const country =
    String(b.country || '').trim();

  const region =
    String(b.region || '').trim();

  const province =
    String(b.province || '').trim();

  const city =
    String(b.city || '').trim();

  const barangay =
    String(b.barangay || '').trim();

  const street =
    String(b.street || '').trim();

  const zip =
    String(b.zip || '').trim();

  const dateOfBirth =
    String(b.dateOfBirth || '').trim();

  if (isBlankField(firstName)) {

    fields.firstName =
      'First name is required.';

  } else if (!isValidName(firstName)) {

    fields.firstName =
      'Enter a valid first name.';
  }

  if (isBlankField(lastName)) {

    fields.lastName =
      'Last name is required.';

  } else if (!isValidName(lastName)) {

    fields.lastName =
      'Enter a valid last name.';
  }

  if (isBlankField(email)) {

    fields.email =
      'Email address is required.';

  } else if (!isValidEmail(email)) {

    fields.email =
      'Enter a valid email address.';
  }

  if (
    confirmEmail &&
    email !== confirmEmail
  ) {

    fields.confirmEmail =
      'Email addresses do not match.';
  }

  if (!password) {

    fields.password =
      'Password is required.';

  } else if (password.length < 6) {

    fields.password =
      'Password must be at least 6 characters.';
  }

  if (
    confirmPassword &&
    password !== confirmPassword
  ) {

    fields.confirmPassword =
      'Passwords do not match.';
  }

  const ok =
    Object.keys(fields).length === 0;

  if (!ok) {

    return {
      ok: false,
      fields,
      error:
        'Please correct the highlighted fields.'
    };
  }

  let base =
    email
      .split('@')[0]
      .replace(/[^a-zA-Z0-9_]/g, '')
      .slice(0, 18) ||
    'customer';

  let username = base;

  while (
    getUser(
      'ua.username=?',
      username
    )
  ) {

    username =
      `${base}${Math.floor(Math.random() * 90 + 10)}`
        .slice(0, 24);
  }

  return {
    ok: true,

    value: {
      firstName,
      middleName,
      lastName,
      suffix,
      email,

      phone:
        phone || '+639170000000',

      password,

      username,

      region:
        region || 'Region XII',

      province:
        province || 'South Cotabato',

      city:
        city || 'Polomolok',

      barangay:
        barangay || 'Poblacion',

      street:
        street || 'Champaca St',

      zip:
        zip || '9504',

      dateOfBirth:
        dateOfBirth || '2000-01-01'
    }
  };
}

/* =========================================================
   API ROUTES
   ========================================================= */

app.get(
  '/api/config',
  (_req, res) => {

    res.json({
      googleClientId:
        process.env.GOOGLE_CLIENT_ID || null
    });

  }
);

app.get(
  '/api/products',
  (_req, res) => {

    res.json(
      db.prepare(productQuery).all()
    );

  }
);

app.get(
  '/api/auth/me',
  (req, res) => {

    res.json({
      user:
        req.session.user || null
    });

  }
);

/* =========================================================
   SIGNUP
   ========================================================= */

app.post(
  '/api/auth/signup',
  authLimiter,
  async (req, res) => {

    const result =
      validateSignupPayload(
        req.body || {}
      );

    if (!result.ok) {

      return res.status(400).json({
        toast: result.error,
        error: result.error,
        fields: result.fields
      });

    }

    const v = result.value;

    try {

      const hash =
        await bcrypt.hash(
          v.password,
          12
        );

      /*
         Generate secure email verification token.
      */

      const verificationToken =
        crypto.randomBytes(32).toString('hex');

      /*
         Token expires after 24 hours.
      */

      const verificationExpiresAt =
        Date.now() +
        (24 * 60 * 60 * 1000);

      let userId;

      db.transaction(() => {

        const customer =
          db.prepare(`
            INSERT INTO customer
            (
              first_name,
              last_name,
              middle_name,
              suffix,
              date_of_birth,
              phone_number,
              email_address
            )
            VALUES (?,?,?,?,?,?,?)
          `).run(
            v.firstName,
            v.lastName,
            v.middleName || null,
            v.suffix || null,
            v.dateOfBirth,
            v.phone,
            v.email
          );

        const customerId =
          customer.lastInsertRowid;

        db.prepare(`
          INSERT INTO customer_address
          (
            customer_id,
            address_type,
            region,
            province,
            city,
            barangay,
            street,
            house_street,
            postal_code
          )
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(
          customerId,
          'Shipping',
          v.region,
          v.province,
          v.city,
          v.barangay,
          v.street,
          v.street,
          v.zip || null
        );

        userId =
          db.prepare(`
            INSERT INTO user_account
            (
              username,
              password_hash,
              customer_id,
              first_name,
              last_name,
              role_id,
              email_verified,
              verification_token,
              verification_expires_at
            )
            VALUES (?,?,?,?,?,2,0,?,?)
          `).run(
            v.username,
            hash,
            customerId,
            v.firstName,
            v.lastName,
            verificationToken,
            verificationExpiresAt
          ).lastInsertRowid;

      })();

      /*
         Send verification email AFTER
         account has been successfully created.
      */

      try {

        await sendVerificationEmail({
          email: v.email,
          firstName: v.firstName,
          token: verificationToken
        });

      } catch (mailError) {

        console.error(
          'Unable to send verification email:',
          mailError.message
        );

        /*
           Account remains created.
           User can use resend-verification.
        */

        return res.status(201).json({
          user: null,

          emailVerificationRequired: true,

          emailSent: false,

          email: v.email,

          toast:
            'Account created, but the verification email could not be sent. Please use Resend Verification.'
        });

      }

      /*
         IMPORTANT:
         Do NOT log the customer in yet.
         They must verify their email first.
      */

      return res.status(201).json({

        user: null,

        emailVerificationRequired: true,

        emailSent: true,

        email: v.email,

        toast:
          `Account created successfully. We sent a verification email to ${v.email}. Please verify your email before logging in.`
      });

    } catch (err) {

      console.error(
        'Signup error:',
        err
      );

      if (
        String(err.message)
          .includes('UNIQUE')
      ) {

        return res.status(409).json({
          error:
            'That email or account is already registered.'
        });

      }

      return res.status(500).json({
        error:
          'Unable to create your account.'
      });
    }

  }
);

/* =========================================================
   RESEND VERIFICATION EMAIL
   ========================================================= */

app.post(
  '/api/auth/resend-verification',
  authLimiter,
  async (req, res) => {

    const email =
      String(
        req.body.email || ''
      )
        .trim()
        .toLowerCase();

    if (!isValidEmail(email)) {

      return res.status(400).json({
        error:
          'Enter a valid email address.'
      });

    }

    try {

      const row =
        getUser(
          'c.email_address=?',
          email
        );

      /*
         Do not reveal whether an email exists.
      */

      if (!row) {

        return res.json({
          ok: true,
          message:
            'If an account exists for that email, a verification email has been sent.'
        });

      }

      if (
        row.email_verified === 1
      ) {

        return res.json({
          ok: true,
          alreadyVerified: true,
          message:
            'This email address is already verified.'
        });

      }

      const token =
        crypto.randomBytes(32).toString('hex');

      const expiresAt =
        Date.now() +
        (24 * 60 * 60 * 1000);

      db.prepare(`
        UPDATE user_account
        SET
          verification_token=?,
          verification_expires_at=?
        WHERE user_id=?
      `).run(
        token,
        expiresAt,
        row.user_id
      );

      await sendVerificationEmail({
        email,
        firstName: row.first_name,
        token
      });

      return res.json({
        ok: true,

        message:
          'A new verification email has been sent.'
      });

    } catch (err) {

      console.error(
        'Resend verification error:',
        err
      );

      return res.status(500).json({
        error:
          'Unable to send the verification email.'
      });
    }

  }
);

/* =========================================================
   VERIFY EMAIL
   ========================================================= */

app.get(
  '/api/auth/verify-email',
  async (req, res) => {

    const token =
      String(
        req.query.token || ''
      ).trim();

    if (!token) {

      return res.status(400).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <title>Verification Failed</title>
          <style>
            body {
              margin:0;
              font-family:Arial,Helvetica,sans-serif;
              background:#f5f5f5;
              display:flex;
              justify-content:center;
              align-items:center;
              min-height:100vh;
            }

            .box {
              max-width:500px;
              background:white;
              padding:40px;
              border-radius:12px;
              text-align:center;
              box-shadow:0 10px 30px rgba(0,0,0,.1);
            }

            h1 {
              color:#e31b23;
            }

            a {
              display:inline-block;
              margin-top:20px;
              background:#111;
              color:white;
              padding:12px 24px;
              text-decoration:none;
              border-radius:6px;
            }
          </style>
        </head>

        <body>
          <div class="box">
            <h1>Verification Failed</h1>

            <p>
              The verification link is missing or invalid.
            </p>

            <a href="/">
              Return to Jay Footwear
            </a>
          </div>
        </body>
        </html>
      `);

    }

    try {

      const row =
        db.prepare(`
          SELECT
            ua.*,
            c.email_address
          FROM user_account ua

          JOIN customer c
            ON c.customer_id=ua.customer_id

          WHERE
            ua.verification_token=?
            AND ua.role_id=2
        `).get(token);

      if (!row) {

        return res.status(400).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Invalid Verification Link</title>

            <style>
              body {
                margin:0;
                font-family:Arial,Helvetica,sans-serif;
                background:#f5f5f5;
                display:flex;
                justify-content:center;
                align-items:center;
                min-height:100vh;
              }

              .box {
                max-width:500px;
                background:white;
                padding:40px;
                border-radius:12px;
                text-align:center;
                box-shadow:0 10px 30px rgba(0,0,0,.1);
              }

              h1 {
                color:#e31b23;
              }

              a {
                display:inline-block;
                margin-top:20px;
                background:#111;
                color:white;
                padding:12px 24px;
                text-decoration:none;
                border-radius:6px;
              }
            </style>
          </head>

          <body>
            <div class="box">

              <h1>
                Invalid Verification Link
              </h1>

              <p>
                This verification link is invalid
                or has already been used.
              </p>

              <a href="/">
                Return to Jay Footwear
              </a>

            </div>
          </body>
          </html>
        `);

      }

      if (
        row.email_verified === 1
      ) {

        return res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Email Already Verified</title>

            <style>
              body {
                margin:0;
                font-family:Arial,Helvetica,sans-serif;
                background:#f5f5f5;
                display:flex;
                justify-content:center;
                align-items:center;
                min-height:100vh;
              }

              .box {
                max-width:500px;
                background:white;
                padding:40px;
                border-radius:12px;
                text-align:center;
                box-shadow:0 10px 30px rgba(0,0,0,.1);
              }

              h1 {
                color:#111;
              }

              .check {
                font-size:60px;
              }

              a {
                display:inline-block;
                margin-top:20px;
                background:#e31b23;
                color:white;
                padding:12px 24px;
                text-decoration:none;
                border-radius:6px;
              }
            </style>
          </head>

          <body>
            <div class="box">

              <div class="check">
                ✓
              </div>

              <h1>
                Email Already Verified
              </h1>

              <p>
                Your Jay Footwear email address
                has already been verified.
              </p>

              <a href="/">
                Go to Jay Footwear
              </a>

            </div>
          </body>
          </html>
        `);

      }

      if (
        !row.verification_expires_at ||
        Number(row.verification_expires_at) < Date.now()
      ) {

        return res.status(410).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <title>Verification Link Expired</title>

            <style>
              body {
                margin:0;
                font-family:Arial,Helvetica,sans-serif;
                background:#f5f5f5;
                display:flex;
                justify-content:center;
                align-items:center;
                min-height:100vh;
              }

              .box {
                max-width:500px;
                background:white;
                padding:40px;
                border-radius:12px;
                text-align:center;
                box-shadow:0 10px 30px rgba(0,0,0,.1);
              }

              h1 {
                color:#e31b23;
              }

              a {
                display:inline-block;
                margin-top:20px;
                background:#111;
                color:white;
                padding:12px 24px;
                text-decoration:none;
                border-radius:6px;
              }
            </style>
          </head>

          <body>
            <div class="box">

              <h1>
                Verification Link Expired
              </h1>

              <p>
                Your verification link has expired.
              </p>

              <p>
                Please request a new verification email.
              </p>

              <a href="/">
                Return to Jay Footwear
              </a>

            </div>
          </body>
          </html>
        `);

      }

      db.prepare(`
        UPDATE user_account

        SET
          email_verified=1,
          verification_token=NULL,
          verification_expires_at=NULL

        WHERE user_id=?
      `).run(row.user_id);

      return res.send(`
        <!DOCTYPE html>
        <html>

        <head>
          <meta charset="UTF-8">
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          >

          <title>Email Verified</title>

          <style>

            body {
              margin:0;
              font-family:Arial,Helvetica,sans-serif;
              background:#f5f5f5;

              display:flex;
              justify-content:center;
              align-items:center;

              min-height:100vh;
            }

            .box {
              width:90%;
              max-width:500px;

              background:white;

              padding:40px;

              border-radius:12px;

              text-align:center;

              box-shadow:
                0 10px 30px rgba(0,0,0,.1);
            }

            .check {
              width:80px;
              height:80px;

              margin:0 auto 20px;

              border-radius:50%;

              background:#16a34a;

              color:white;

              font-size:50px;

              line-height:80px;
            }

            h1 {
              color:#111;
              margin-bottom:10px;
            }

            p {
              color:#555;
              line-height:1.6;
            }

            a {
              display:inline-block;

              margin-top:20px;

              background:#e31b23;

              color:white;

              padding:13px 25px;

              text-decoration:none;

              border-radius:6px;

              font-weight:bold;
            }

          </style>
        </head>

        <body>

          <div class="box">

            <div class="check">
              ✓
            </div>

            <h1>
              Email Verified!
            </h1>

            <p>
              Your Jay Footwear email address
              has been successfully verified.
            </p>

            <p>
              You can now sign in to your account.
            </p>

            <a href="/">
              Go to Jay Footwear
            </a>

          </div>

        </body>
        </html>
      `);

    } catch (err) {

      console.error(
        'Email verification error:',
        err
      );

      return res.status(500).send(`
        <h1>
          Unable to verify email
        </h1>

        <p>
          Please try again later.
        </p>
      `);

    }

  }
);

/* =========================================================
   LOGIN
   ========================================================= */

app.post(
  '/api/auth/login',
  authLimiter,
  async (req, res) => {

    const login =
      String(
        req.body.login || ''
      ).trim();

    if (!login) {

      return res.status(400).json({
        error:
          'Enter your username or email.'
      });

    }

    const row =
      getUser(
        'ua.username=? OR c.email_address=?',
        login,
        login.toLowerCase()
      );

    if (
      !row ||
      !row.password_hash ||
      !(await bcrypt.compare(
        String(req.body.password || ''),
        row.password_hash
      ))
    ) {

      return res.status(401).json({
        error:
          'Incorrect username/email or password.'
      });

    }

    if (
      row.account_status !== 'Active'
    ) {

      return res.status(403).json({
        error:
          'This account is inactive.'
      });

    }

    /*
       CUSTOMER EMAIL VERIFICATION CHECK

       Admin, cashier and owner accounts
       are not blocked by email verification.
    */

    if (
      row.role_name.toLowerCase() === 'customer' &&
      row.email_verified !== 1
    ) {

      return res.status(403).json({

        error:
          'Please verify your email before logging in.',

        code:
          'EMAIL_NOT_VERIFIED',

        email:
          row.email_address

      });

    }

    req.session.regenerate(
      err => {

        if (err) {

          return res.status(500).json({
            error:
              'Unable to start session.'
          });

        }

        req.session.user =
          safeUser(row);

        res.json({
          user:
            req.session.user
        });

      }
    );

  }
);

/* =========================================================
   LOGOUT
   ========================================================= */

app.post(
  '/api/auth/logout',
  (req, res) => {

    req.session.destroy(
      () => {

        res.clearCookie(
          'connect.sid'
        );

        res.json({
          ok: true
        });

      }
    );

  }
);

/* =========================================================
   CUSTOMER CHECKOUT
   ========================================================= */

app.get(
  '/api/customer/checkout',
  requireRole('customer'),
  (req, res) => {

    const account =
      db.prepare(`
        SELECT
          ua.customer_id,

          c.first_name ||
            ' ' ||
            c.last_name AS name,

          c.email_address,

          ca.house_street,
          ca.barangay,
          ca.city,
          ca.province,
          ca.postal_code

        FROM user_account ua

        JOIN customer c
          ON c.customer_id=ua.customer_id

        LEFT JOIN customer_address ca
          ON ca.customer_id=c.customer_id
          AND ca.address_type='Shipping'

        WHERE ua.user_id=?
      `).get(
        req.session.user.id
      );

    const paymentMethods =
      db.prepare(`
        SELECT
          method_id,
          method_name

        FROM payment_method

        WHERE is_active=1

        ORDER BY method_id
      `).all();

    res.json({
      customer: account,
      paymentMethods
    });

  }
);

/* =========================================================
   CUSTOMER ORDERS
   ========================================================= */

app.post(
  '/api/customer/orders',
  requireRole('customer'),
  (req, res) => {

    const items =
      Array.isArray(req.body.items)
        ? req.body.items
        : [];

    const methodId =
      Number(req.body.methodId);

    const address =
      req.body.address || {};

    if (!items.length) {

      return res.status(400).json({
        error:
          'Your cart is empty.'
      });

    }

    try {

      let order;

      db.transaction(() => {

        const account =
          db.prepare(`
            SELECT customer_id
            FROM user_account
            WHERE user_id=?
          `).get(
            req.session.user.id
          );

        if (!account?.customer_id) {
          throw new Error('CUSTOMER');
        }

        const method =
          db.prepare(`
            SELECT *
            FROM payment_method
            WHERE method_id=?
            AND is_active=1
          `).get(
            methodId
          );

        if (!method) {
          throw new Error('PAYMENT');
        }

        const detailed =
          items.map(item => {

            const quantity =
              Number(item.quantity);

            const row =
              db.prepare(`
                SELECT
                  pv.variant_id,
                  pv.sku,
                  p.product_name name,
                  p.selling_price price,
                  i.stock_quantity stock

                FROM product_variant pv

                JOIN product p
                  ON p.product_id=pv.product_id

                JOIN inventory i
                  ON i.variant_id=pv.variant_id

                WHERE pv.variant_id=?
                AND p.is_active=1
              `).get(
                Number(item.variantId)
              );

            return {
              ...row,
              quantity
            };

          });

        const subtotal =
          detailed.reduce(
            (sum, x) =>
              sum + x.price * x.quantity,
            0
          );

        const sale =
          db.prepare(`
            INSERT INTO sales_transaction
            (
              sale_date,
              user_id,
              customer_id,
              order_discount,
              sale_status
            )
            VALUES
            (
              CURRENT_TIMESTAMP,
              ?,
              ?,
              0,
              'Processing'
            )
          `).run(
            req.session.user.id,
            account.customer_id
          );

        const addItem =
          db.prepare(`
            INSERT INTO sales_item
            (
              sale_id,
              variant_id,
              quantity,
              unit_price,
              line_discount
            )
            VALUES (?,?,?,?,0)
          `);

        const reduce =
          db.prepare(`
            UPDATE inventory

            SET
              stock_quantity =
                stock_quantity-?,

              last_updated =
                CURRENT_TIMESTAMP

            WHERE variant_id=?
          `);

        detailed.forEach(x => {

          addItem.run(
            sale.lastInsertRowid,
            x.variant_id,
            x.quantity,
            x.price
          );

          reduce.run(
            x.quantity,
            x.variant_id
          );

        });

        const reference =
          `WEB-${String(
            sale.lastInsertRowid
          ).padStart(6, '0')}`;

        db.prepare(`
          INSERT INTO payment
          (
            sale_id,
            method_id,
            payment_date,
            amount_paid,
            reference_number,
            payment_status
          )
          VALUES
          (
            ?,
            ?,
            CURRENT_TIMESTAMP,
            ?,
            ?,
            'Pending'
          )
        `).run(
          sale.lastInsertRowid,
          methodId,
          subtotal,
          reference
        );

        order = {
          saleId:
            sale.lastInsertRowid,

          reference,

          total:
            subtotal,

          status:
            'Processing',

          paymentMethod:
            method.method_name,

          items:
            detailed
        };

      })();

      res.status(201).json({
        order
      });

    } catch (err) {

      console.error(
        'Customer order error:',
        err
      );

      res.status(500).json({
        error:
          'Unable to place your order.'
      });

    }

  }
);

/* =========================================================
   CASHIER WORKSPACE
   ========================================================= */

app.get(
  '/api/cashier/workspace',
  requireRole('cashier'),
  (_req, res) => {

    const catalog =
      db.prepare(`
        SELECT
          pv.variant_id,
          pv.sku,
          p.product_name AS name,
          b.brand_name AS brand,

          ss.size_system ||
            ' ' ||
            CAST(ss.size_value AS TEXT) AS size,

          p.selling_price AS price,

          p.image_path AS image,

          i.stock_quantity AS stock

        FROM product p

        JOIN brand b
          ON b.brand_id=p.brand_id

        JOIN product_variant pv
          ON pv.product_id=p.product_id

        JOIN shoe_size ss
          ON ss.size_id=pv.size_id

        JOIN inventory i
          ON i.variant_id=pv.variant_id

        WHERE p.is_active=1

        ORDER BY p.product_id
      `).all();

    const customers =
      db.prepare(`
        SELECT
          customer_id,

          first_name ||
            ' ' ||
            last_name AS name,

          email_address AS email

        FROM customer

        ORDER BY
          first_name,
          last_name
      `).all();

    const paymentMethods =
      db.prepare(`
        SELECT
          method_id,
          method_name

        FROM payment_method

        WHERE is_active=1

        ORDER BY method_id
      `).all();

    const recentSales =
      db.prepare(`
        SELECT
          st.sale_id,

          date(st.sale_date) sale_date,

          COALESCE(
            c.first_name ||
              ' ' ||
              c.last_name,
            'Walk-in Customer'
          ) customer,

          SUM(
            si.quantity *
            si.unit_price -
            si.line_discount
          ) -
          st.order_discount total,

          st.sale_status status

        FROM sales_transaction st

        LEFT JOIN customer c
          ON c.customer_id=st.customer_id

        JOIN sales_item si
          ON si.sale_id=st.sale_id

        GROUP BY st.sale_id

        ORDER BY st.sale_id DESC

        LIMIT 10
      `).all();

    res.json({
      catalog,
      customers,
      paymentMethods,
      recentSales
    });

  }
);

/* =========================================================
   CASHIER SALES
   ========================================================= */

app.post(
  '/api/cashier/sales',
  requireRole('cashier'),
  (req, res) => {

    const items =
      Array.isArray(req.body.items)
        ? req.body.items
        : [];

    const customerId =
      req.body.customerId
        ? Number(req.body.customerId)
        : null;

    const methodId =
      Number(req.body.methodId);

    const discountPercent =
      Number(
        req.body.discountPercent || 0
      );

    if (!items.length) {

      return res.status(400).json({
        error:
          'Add at least one product to the sale.'
      });

    }

    try {

      let receipt;

      db.transaction(() => {

        const method =
          db.prepare(`
            SELECT *
            FROM payment_method

            WHERE method_id=?
            AND is_active=1
          `).get(
            methodId
          );

        const detailed =
          items.map(item => {

            const quantity =
              Number(item.quantity);

            const row =
              db.prepare(`
                SELECT
                  pv.variant_id,
                  pv.sku,
                  p.product_name name,
                  p.selling_price price,
                  i.stock_quantity stock

                FROM product_variant pv

                JOIN product p
                  ON p.product_id=pv.product_id

                JOIN inventory i
                  ON i.variant_id=pv.variant_id

                WHERE pv.variant_id=?
              `).get(
                Number(item.variantId)
              );

            return {
              ...row,
              quantity
            };

          });

        const subtotal =
          detailed.reduce(
            (sum, x) =>
              sum + x.price * x.quantity,
            0
          );

        const discount =
          Math.round(
            subtotal *
            (discountPercent / 100) *
            100
          ) / 100;

        const total =
          subtotal - discount;

        const sale =
          db.prepare(`
            INSERT INTO sales_transaction
            (
              sale_date,
              user_id,
              customer_id,
              order_discount,
              sale_status
            )
            VALUES
            (
              CURRENT_TIMESTAMP,
              ?,
              ?,
              ?,
              'Completed'
            )
          `).run(
            req.session.user.id,
            customerId,
            discount
          );

        const addItem =
          db.prepare(`
            INSERT INTO sales_item
            (
              sale_id,
              variant_id,
              quantity,
              unit_price,
              line_discount
            )
            VALUES (?,?,?,?,0)
          `);

        const reduceStock =
          db.prepare(`
            UPDATE inventory

            SET
              stock_quantity =
                stock_quantity-?,

              last_updated =
                CURRENT_TIMESTAMP

            WHERE variant_id=?
          `);

        detailed.forEach(x => {

          addItem.run(
            sale.lastInsertRowid,
            x.variant_id,
            x.quantity,
            x.price
          );

          reduceStock.run(
            x.quantity,
            x.variant_id
          );

        });

        const reference =
          `JF-${String(
            sale.lastInsertRowid
          ).padStart(6, '0')}`;

        db.prepare(`
          INSERT INTO payment
          (
            sale_id,
            method_id,
            payment_date,
            amount_paid,
            reference_number,
            payment_status
          )
          VALUES
          (
            ?,
            ?,
            CURRENT_TIMESTAMP,
            ?,
            ?,
            'Paid'
          )
        `).run(
          sale.lastInsertRowid,
          methodId,
          total,
          reference
        );

        const customer =
          customerId
            ? db.prepare(`
                SELECT
                  first_name ||
                    ' ' ||
                    last_name name

                FROM customer

                WHERE customer_id=?
              `).get(customerId)
            : null;

        receipt = {

          saleId:
            sale.lastInsertRowid,

          reference,

          date:
            new Date().toISOString(),

          cashier:
            req.session.user.fullName,

          customer:
            customer?.name ||
            'Walk-in Customer',

          paymentMethod:
            method.method_name,

          items:
            detailed,

          subtotal,

          discountPercent,

          discount,

          total

        };

      })();

      res.status(201).json({
        receipt
      });

    } catch (err) {

      console.error(
        'Cashier sale error:',
        err
      );

      res.status(500).json({
        error:
          'Unable to process the sale.'
      });

    }

  }
);

/* =========================================================
   OWNER REPORTS
   ========================================================= */

app.get(
  '/api/owner/reports',
  requireRole(
    'owner/manager',
    'admin'
  ),
  (_req, res) => {

    const inventory =
      db.prepare(`
        SELECT
          pv.sku,
          p.product_name,
          b.brand_name,
          i.stock_quantity,
          i.reorder_level,
          p.selling_price

        FROM inventory i

        JOIN product_variant pv
          ON pv.variant_id=i.variant_id

        JOIN product p
          ON p.product_id=pv.product_id

        JOIN brand b
          ON b.brand_id=p.brand_id

        ORDER BY p.product_id
      `).all();

    const sales =
      db.prepare(`
        SELECT
          st.sale_id,

          date(st.sale_date)
            sale_date,

          COALESCE(
            c.first_name ||
              ' ' ||
              c.last_name,
            'Walk-in Customer'
          ) customer,

          SUM(
            si.quantity *
            si.unit_price -
            si.line_discount
          ) -
          st.order_discount total,

          st.sale_status status

        FROM sales_transaction st

        LEFT JOIN customer c
          ON c.customer_id=st.customer_id

        JOIN sales_item si
          ON si.sale_id=st.sale_id

        GROUP BY st.sale_id

        ORDER BY st.sale_id DESC
      `).all();

    const suppliers =
      db.prepare(
        supplierQuery
      ).all();

    const totals =
      db.prepare(`
        SELECT

          COUNT(
            DISTINCT st.sale_id
          ) transactions,

          COALESCE(
            SUM(si.quantity),
            0
          ) pairs,

          COALESCE(
            SUM(
              si.quantity *
              si.unit_price -
              si.line_discount
            ),
            0
          )
          -
          (
            SELECT
              COALESCE(
                SUM(order_discount),
                0
              )

            FROM sales_transaction
          ) revenue

        FROM sales_transaction st

        JOIN sales_item si
          ON si.sale_id=st.sale_id
      `).get();

    res.json({

      inventory,

      sales,

      suppliers,

      totals,

      lowStock:
        inventory.filter(
          x =>
            x.stock_quantity <=
            x.reorder_level
        )

    });

  }
);

/* =========================================================
   ADMIN RECORDS
   ========================================================= */

app.get(
  '/api/admin/records',
  requireAdmin,
  (_req, res) => {

    res.json({

      products:
        db.prepare(
          productQuery
        ).all(),

      orders:
        db.prepare(
          orderQuery
        ).all(),

      customers:
        db.prepare(
          customerQuery
        ).all(),

      suppliers:
        db.prepare(
          supplierQuery
        ).all(),

      cashiers:
        db.prepare(
          cashierQuery
        ).all()

    });

  }
);

/* =========================================================
   ADMIN MANAGEMENT
   ========================================================= */

app.get(
  '/api/admin/management',
  requireAdmin,
  (_req, res) => {

    const inventory =
      db.prepare(`
        SELECT

          p.product_id,

          pv.variant_id,

          pv.sku,

          p.product_name,

          b.brand_name,

          b.brand_id,

          p.category_id,

          p.condition_id,

          p.selling_price,

          p.image_path,

          p.is_active,

          pv.size_id,

          ss.size_system ||
            ' ' ||
            CAST(
              ss.size_value AS TEXT
            ) size,

          i.stock_quantity,

          i.reorder_level,

          i.last_updated

        FROM inventory i

        JOIN product_variant pv
          ON pv.variant_id=i.variant_id

        JOIN product p
          ON p.product_id=pv.product_id

        JOIN brand b
          ON b.brand_id=p.brand_id

        JOIN shoe_size ss
          ON ss.size_id=pv.size_id

        ORDER BY p.product_id
      `).all();

    const users =
      db.prepare(`
        SELECT

          ua.user_id,

          ua.username,

          ua.first_name ||
            ' ' ||
            ua.last_name name,

          r.role_name role,

          ua.account_status status,

          date(
            ua.created_at
          ) created_date

        FROM user_account ua

        JOIN role r
          ON r.role_id=ua.role_id

        ORDER BY ua.user_id
      `).all();

    const purchaseOrders =
      db.prepare(`
        SELECT

          po.purchase_order_id AS po_no,

          s.supplier_name,

          po.order_date,

          po.expected_date,

          po.received_date,

          po.po_status,

          COALESCE(
            SUM(
              poi.quantity_ordered *
              poi.unit_cost
            ),
            0
          ) total

        FROM purchase_order po

        JOIN supplier s
          ON s.supplier_id=po.supplier_id

        LEFT JOIN purchase_order_item poi
          ON poi.purchase_order_id=
             po.purchase_order_id

        GROUP BY po.purchase_order_id

        ORDER BY
          po.purchase_order_id DESC
      `).all();

    const sales =
      db.prepare(
        orderQuery
      ).all();

    const customers =
      db.prepare(
        customerQuery
      ).all();

    const suppliers =
      db.prepare(
        supplierQuery
      ).all();

    const options = {

      categories:
        db.prepare(`
          SELECT
            category_id id,
            category_name name

          FROM category

          ORDER BY category_name
        `).all(),

      brands:
        db.prepare(`
          SELECT
            brand_id id,
            brand_name name

          FROM brand

          ORDER BY brand_name
        `).all(),

      conditions:
        db.prepare(`
          SELECT
            condition_id id,
            condition_name name

          FROM product_condition

          ORDER BY condition_id
        `).all(),

      sizes:
        db.prepare(`
          SELECT
            size_id id,

            size_system ||
              ' ' ||
              CAST(
                size_value AS TEXT
              ) name

          FROM shoe_size

          ORDER BY size_value
        `).all()

    };

    res.json({

      inventory,

      users,

      purchaseOrders,

      sales,

      customers,

      suppliers,

      options,

      summary: {

        products:
          db.prepare(`
            SELECT COUNT(*) count
            FROM product
            WHERE is_active=1
          `).get().count,

        stock:
          db.prepare(`
            SELECT
              COALESCE(
                SUM(stock_quantity),
                0
              ) count

            FROM inventory
          `).get().count,

        lowStock:
          db.prepare(`
            SELECT COUNT(*) count

            FROM inventory

            WHERE
              stock_quantity <=
              reorder_level
          `).get().count,

        salesTotal:
          db.prepare(`
            SELECT
              COALESCE(
                SUM(
                  quantity *
                  unit_price -
                  line_discount
                ),
                0
              ) total

            FROM sales_item
          `).get().total

      }

    });

  }
);

/* =========================================================
   UPDATE INVENTORY
   ========================================================= */

app.patch(
  '/api/admin/inventory/:id',
  requireAdmin,
  (req, res) => {

    const quantity =
      Number(
        req.body.stockQuantity
      );

    if (
      !Number.isInteger(quantity) ||
      quantity < 0
    ) {

      return res.status(400).json({
        error:
          'Stock quantity must be a non-negative whole number.'
      });

    }

    const result =
      db.prepare(`
        UPDATE inventory

        SET
          stock_quantity=?,
          last_updated=
            CURRENT_TIMESTAMP

        WHERE variant_id=?
      `).run(
        quantity,
        req.params.id
      );

    if (!result.changes) {

      return res.status(404).json({
        error:
          'Inventory item not found.'
      });

    }

    res.json({
      ok: true,
      stockQuantity:
        quantity
    });

  }
);

/* =========================================================
   ADD PRODUCT
   ========================================================= */

app.post(
  '/api/admin/products',
  requireAdmin,
  (req, res) => {

    const {
      name,
      categoryId,
      brandId,
      conditionId,
      price,
      sku,
      sizeId,
      stock,
      imagePath
    } = req.body;

    if (!name || !sku) {

      return res.status(400).json({
        error:
          'Product name and SKU are required.'
      });

    }

    try {

      db.transaction(() => {

        const product =
          db.prepare(`
            INSERT INTO product
            (
              product_name,
              category_id,
              brand_id,
              condition_id,
              selling_price,
              image_path
            )
            VALUES (?,?,?,?,?,?)
          `).run(
            String(name).trim(),
            Number(categoryId),
            Number(brandId),
            Number(conditionId),
            Number(price),
            String(
              imagePath ||
              'images/products/574-core.jpg'
            ).trim()
          );

        const variant =
          db.prepare(`
            INSERT INTO product_variant
            (
              product_id,
              size_id,
              sku
            )
            VALUES (?,?,?)
          `).run(
            product.lastInsertRowid,
            Number(sizeId),
            String(sku)
              .trim()
              .toUpperCase()
          );

        db.prepare(`
          INSERT INTO inventory
          (
            variant_id,
            stock_quantity,
            reorder_level
          )
          VALUES (?,?,1)
        `).run(
          variant.lastInsertRowid,
          Number(stock)
        );

      })();

      res.status(201).json({
        ok: true
      });

    } catch (err) {

      console.error(
        'Add product error:',
        err
      );

      res.status(400).json({
        error:
          'Unable to add product.'
      });

    }

  }
);

/* =========================================================
   UPDATE PRODUCT
   ========================================================= */

app.patch(
  '/api/admin/products/:id',
  requireAdmin,
  (req, res) => {

    const {
      name,
      categoryId,
      brandId,
      conditionId,
      price,
      sku,
      sizeId,
      imagePath,
      isActive
    } = req.body;

    try {

      db.transaction(() => {

        const result =
          db.prepare(`
            UPDATE product

            SET
              product_name=?,
              category_id=?,
              brand_id=?,
              condition_id=?,
              selling_price=?,
              image_path=?,
              is_active=?

            WHERE product_id=?
          `).run(
            String(name).trim(),
            Number(categoryId),
            Number(brandId),
            Number(conditionId),
            Number(price),
            String(
              imagePath || ''
            ).trim(),
            isActive ? 1 : 0,
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

        db.prepare(`
          UPDATE product_variant

          SET
            sku=?,
            size_id=?

          WHERE product_id=?
        `).run(
          String(sku)
            .trim()
            .toUpperCase(),

          Number(sizeId),

          req.params.id
        );

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      res.status(400).json({
        error:
          'Unable to update product.'
      });

    }

  }
);

/* =========================================================
   DELETE PRODUCT
   ========================================================= */

app.delete(
  '/api/admin/products/:id',
  requireAdmin,
  (req, res) => {

    try {

      db.transaction(() => {

        const variants =
          db.prepare(`
            SELECT variant_id
            FROM product_variant
            WHERE product_id=?
          `).all(
            req.params.id
          );

        variants.forEach(v => {

          db.prepare(`
            DELETE FROM inventory
            WHERE variant_id=?
          `).run(
            v.variant_id
          );

        });

        db.prepare(`
          DELETE FROM product_variant
          WHERE product_id=?
        `).run(
          req.params.id
        );

        const result =
          db.prepare(`
            DELETE FROM product
            WHERE product_id=?
          `).run(
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      if (
        err.message ===
        'NOT_FOUND'
      ) {

        return res.status(404).json({
          error:
            'Product not found.'
        });

      }

      res.status(500).json({
        error:
          'Unable to delete product.'
      });

    }

  }
);

/* =========================================================
   DELETE SUPPLIER
   ========================================================= */

app.delete(
  '/api/admin/suppliers/:id',
  requireAdmin,
  (req, res) => {

    try {

      db.transaction(() => {

        db.prepare(`
          DELETE FROM supplier_address
          WHERE supplier_id=?
        `).run(
          req.params.id
        );

        const result =
          db.prepare(`
            DELETE FROM supplier
            WHERE supplier_id=?
          `).run(
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      if (
        err.message ===
        'NOT_FOUND'
      ) {

        return res.status(404).json({
          error:
            'Supplier not found.'
        });

      }

      res.status(500).json({
        error:
          'Unable to delete supplier.'
      });

    }

  }
);

/* =========================================================
   DELETE USER ACCOUNT
   ========================================================= */

app.delete(
  '/api/admin/users/:id',
  requireAdmin,
  (req, res) => {

    if (
      Number(req.params.id) ===
      req.session.user.id
    ) {

      return res.status(400).json({
        error:
          'You cannot delete your own logged-in admin account.'
      });

    }

    const result =
      db.prepare(`
        DELETE FROM user_account
        WHERE user_id=?
      `).run(
        req.params.id
      );

    if (!result.changes) {

      return res.status(404).json({
        error:
          'User not found.'
      });

    }

    res.json({
      ok: true
    });

  }
);

/* =========================================================
   DELETE PURCHASE ORDER
   ========================================================= */

app.delete(
  '/api/admin/purchase-orders/:id',
  requireAdmin,
  (req, res) => {

    try {

      db.transaction(() => {

        db.prepare(`
          DELETE FROM purchase_order_item
          WHERE purchase_order_id=?
        `).run(
          req.params.id
        );

        const result =
          db.prepare(`
            DELETE FROM purchase_order
            WHERE purchase_order_id=?
          `).run(
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      res.status(500).json({
        error:
          'Unable to delete purchase order.'
      });

    }

  }
);

/* =========================================================
   ADD SUPPLIER
   ========================================================= */

app.post(
  '/api/admin/suppliers',
  requireAdmin,
  (req, res) => {

    const {
      name,
      contactPerson,
      phone,
      email,
      city,
      province
    } = req.body;

    if (
      !name ||
      !contactPerson
    ) {

      return res.status(400).json({
        error:
          'Supplier name and contact person are required.'
      });

    }

    try {

      db.transaction(() => {

        const supplier =
          db.prepare(`
            INSERT INTO supplier
            (
              supplier_name,
              contact_person,
              phone_number,
              email_address,
              supplier_status
            )
            VALUES
            (?,?,?,?,'Active')
          `).run(
            String(name).trim(),
            String(contactPerson).trim(),
            String(phone || '').trim(),
            String(email || '').trim()
          );

        db.prepare(`
          INSERT INTO supplier_address
          (
            supplier_id,
            city,
            province
          )
          VALUES (?,?,?)
        `).run(
          supplier.lastInsertRowid,
          String(city || '').trim(),
          String(province || '').trim()
        );

      })();

      res.status(201).json({
        ok: true
      });

    } catch (err) {

      res.status(400).json({
        error:
          'Unable to add supplier.'
      });

    }

  }
);

/* =========================================================
   UPDATE SUPPLIER
   ========================================================= */

app.patch(
  '/api/admin/suppliers/:id',
  requireAdmin,
  (req, res) => {

    const {
      name,
      contactPerson,
      phone,
      email,
      city,
      province,
      status
    } = req.body;

    try {

      db.transaction(() => {

        const result =
          db.prepare(`
            UPDATE supplier

            SET
              supplier_name=?,
              contact_person=?,
              phone_number=?,
              email_address=?,
              supplier_status=?

            WHERE supplier_id=?
          `).run(
            String(name).trim(),
            String(contactPerson).trim(),
            String(phone || '').trim(),
            String(email || '').trim(),
            status || 'Active',
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

        const address =
          db.prepare(`
            SELECT address_id
            FROM supplier_address
            WHERE supplier_id=?
          `).get(
            req.params.id
          );

        if (address) {

          db.prepare(`
            UPDATE supplier_address

            SET
              city=?,
              province=?

            WHERE supplier_id=?
          `).run(
            city || '',
            province || '',
            req.params.id
          );

        } else {

          db.prepare(`
            INSERT INTO supplier_address
            (
              supplier_id,
              city,
              province
            )
            VALUES (?,?,?)
          `).run(
            req.params.id,
            city || '',
            province || ''
          );

        }

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      res.status(400).json({
        error:
          'Unable to update supplier.'
      });

    }

  }
);

/* =========================================================
   ADD CASHIER
   ========================================================= */

app.post(
  '/api/admin/cashiers',
  requireAdmin,
  async (req, res) => {

    const {
      username,
      firstName,
      lastName,
      password
    } = req.body;

    if (
      !/^[a-zA-Z0-9_]{3,24}$/.test(
        username || ''
      ) ||
      !firstName ||
      !lastName ||
      String(password || '').length < 8
    ) {

      return res.status(400).json({
        error:
          'Enter a valid username, full name, and password of at least 8 characters.'
      });

    }

    try {

      const hash =
        await bcrypt.hash(
          password,
          12
        );

      db.prepare(`
        INSERT INTO user_account
        (
          username,
          password_hash,
          first_name,
          last_name,
          role_id,
          account_status,
          email_verified
        )
        VALUES
        (?,?,?,?,3,'Active',1)
      `).run(
        username.trim(),
        hash,
        firstName.trim(),
        lastName.trim()
      );

      res.status(201).json({
        ok: true
      });

    } catch (err) {

      res.status(500).json({
        error:
          'Unable to add cashier.'
      });

    }

  }
);

/* =========================================================
   UPDATE USER
   ========================================================= */

app.patch(
  '/api/admin/users/:id',
  requireAdmin,
  (req, res) => {

    const {
      firstName,
      lastName,
      status
    } = req.body;

    if (
      Number(req.params.id) ===
        req.session.user.id &&
      status === 'Inactive'
    ) {

      return res.status(400).json({
        error:
          'You cannot deactivate your own account.'
      });

    }

    const result =
      db.prepare(`
        UPDATE user_account

        SET
          first_name=?,
          last_name=?,
          account_status=?

        WHERE user_id=?
      `).run(
        String(firstName || '').trim(),
        String(lastName || '').trim(),
        status === 'Inactive'
          ? 'Inactive'
          : 'Active',
        req.params.id
      );

    if (!result.changes) {

      return res.status(404).json({
        error:
          'User not found.'
      });

    }

    res.json({
      ok: true
    });

  }
);

/* =========================================================
   UPDATE CUSTOMER
   ========================================================= */

app.patch(
  '/api/admin/customers/:id',
  requireAdmin,
  (req, res) => {

    const {
      firstName,
      lastName,
      email,
      city
    } = req.body;

    try {

      db.transaction(() => {

        const result =
          db.prepare(`
            UPDATE customer

            SET
              first_name=?,
              last_name=?,
              email_address=?

            WHERE customer_id=?
          `).run(
            String(firstName).trim(),
            String(lastName).trim(),
            String(email)
              .trim()
              .toLowerCase(),
            req.params.id
          );

        if (!result.changes) {
          throw new Error(
            'NOT_FOUND'
          );
        }

        db.prepare(`
          UPDATE customer_address

          SET city=?

          WHERE customer_id=?
        `).run(
          String(city || '').trim(),
          req.params.id
        );

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      res.status(409).json({
        error:
          'Unable to update customer.'
      });

    }

  }
);

/* =========================================================
   CREATE PURCHASE ORDER
   ========================================================= */

app.post(
  '/api/admin/purchase-orders',
  requireAdmin,
  (req, res) => {

    const {
      supplierId,
      variantId,
      quantity,
      unitCost,
      expectedDate
    } = req.body;

    if (
      !Number.isInteger(
        Number(quantity)
      ) ||
      Number(quantity) < 1 ||
      !Number.isFinite(
        Number(unitCost)
      ) ||
      Number(unitCost) < 0
    ) {

      return res.status(400).json({
        error:
          'Enter a valid quantity and unit cost.'
      });

    }

    try {

      db.transaction(() => {

        const po =
          db.prepare(`
            INSERT INTO purchase_order
            (
              supplier_id,
              user_id,
              order_date,
              expected_date,
              po_status
            )
            VALUES
            (
              ?,
              ?,
              date('now'),
              ?,
              'Ordered'
            )
          `).run(
            Number(supplierId),
            req.session.user.id,
            expectedDate || null
          );

        db.prepare(`
          INSERT INTO purchase_order_item
          (
            purchase_order_id,
            variant_id,
            quantity_ordered,
            quantity_received,
            unit_cost
          )
          VALUES (?,?,?,0,?)
        `).run(
          po.lastInsertRowid,
          Number(variantId),
          Number(quantity),
          Number(unitCost)
        );

      })();

      res.status(201).json({
        ok: true
      });

    } catch (_err) {

      res.status(400).json({
        error:
          'Unable to create purchase order.'
      });

    }

  }
);

/* =========================================================
   RECEIVE PURCHASE ORDER
   ========================================================= */

app.post(
  '/api/admin/purchase-orders/:id/receive',
  requireAdmin,
  (req, res) => {

    try {

      db.transaction(() => {

        const po =
          db.prepare(`
            SELECT *
            FROM purchase_order
            WHERE purchase_order_id=?
          `).get(
            req.params.id
          );

        if (!po) {
          throw new Error(
            'NOT_FOUND'
          );
        }

        if (
          po.po_status ===
          'Received'
        ) {
          throw new Error(
            'ALREADY_RECEIVED'
          );
        }

        const items =
          db.prepare(`
            SELECT *
            FROM purchase_order_item
            WHERE purchase_order_id=?
          `).all(
            req.params.id
          );

        items.forEach(item => {

          const add =
            item.quantity_ordered -
            item.quantity_received;

          if (add > 0) {

            db.prepare(`
              UPDATE inventory

              SET
                stock_quantity =
                  stock_quantity + ?,

                last_updated =
                  CURRENT_TIMESTAMP

              WHERE variant_id=?
            `).run(
              add,
              item.variant_id
            );

          }

        });

        db.prepare(`
          UPDATE purchase_order_item

          SET
            quantity_received=
              quantity_ordered

          WHERE purchase_order_id=?
        `).run(
          req.params.id
        );

        db.prepare(`
          UPDATE purchase_order

          SET
            po_status='Received',
            received_date=date('now')

          WHERE purchase_order_id=?
        `).run(
          req.params.id
        );

      })();

      res.json({
        ok: true
      });

    } catch (err) {

      res.status(500).json({
        error:
          'Unable to record delivery.'
      });

    }

  }
);

/* =========================================================
   SCHEMA STATUS
   ========================================================= */

app.get(
  '/api/admin/schema-status',
  requireAdmin,
  (_req, res) => {

    const tables = [
      'user_account',
      'role',
      'customer',
      'customer_address',
      'supplier',
      'supplier_address',
      'category',
      'brand',
      'product_condition',
      'shoe_size',
      'payment_method',
      'product',
      'product_variant',
      'inventory',
      'sales_transaction',
      'sales_item',
      'payment',
      'purchase_order',
      'purchase_order_item'
    ];

    res.json({

      connected: true,

      database:
        'SQLite (normalized ERD implementation)',

      tables:
        tables.map(name => ({
          name,

          records:
            db.prepare(
              `SELECT COUNT(*) count FROM ${name}`
            ).get().count
        }))

    });

  }
);

/* =========================================================
   404 HANDLERS
   ========================================================= */

app.use(
  '/api',
  (_req, res) =>
    res.status(404).json({
      error:
        'API endpoint not found.'
    })
);

app.use(
  (_req, res) =>
    res.status(404).sendFile(
      path.join(
        __dirname,
        'public',
        '404.html'
      )
    )
);

/* =========================================================
   START SERVER
   ========================================================= */

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Jay Footwear is running at http://localhost:${PORT}`
    );

  }
);
