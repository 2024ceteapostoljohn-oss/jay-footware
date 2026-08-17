require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, 'data', 'jay-footwear.db'));
db.pragma('foreign_keys = ON');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-development-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 8 }
}));
app.use(express.static(path.join(__dirname, 'public')));
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 40, standardHeaders: true, legacyHeaders: false });

function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS role (
      role_id INTEGER PRIMARY KEY, role_name TEXT UNIQUE NOT NULL, role_description TEXT
    );
    CREATE TABLE IF NOT EXISTS customer (
      customer_id INTEGER PRIMARY KEY AUTOINCREMENT, first_name TEXT NOT NULL, last_name TEXT NOT NULL,
      phone_number TEXT, email_address TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS customer_address (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id INTEGER NOT NULL, address_type TEXT,
      house_street TEXT, barangay TEXT, city TEXT NOT NULL, province TEXT NOT NULL, postal_code TEXT,
      FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS user_account (
      user_id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT,
      customer_id INTEGER, first_name TEXT NOT NULL, last_name TEXT NOT NULL, role_id INTEGER NOT NULL,
      account_status TEXT NOT NULL DEFAULT 'Active', google_id TEXT UNIQUE, created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE SET NULL,
      FOREIGN KEY (role_id) REFERENCES role(role_id)
    );
    CREATE TABLE IF NOT EXISTS supplier (
      supplier_id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_name TEXT UNIQUE NOT NULL, contact_person TEXT,
      phone_number TEXT, email_address TEXT, supplier_status TEXT
    );
    CREATE TABLE IF NOT EXISTS supplier_address (
      address_id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, house_street TEXT,
      barangay TEXT, city TEXT, province TEXT, postal_code TEXT,
      FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS category (
      category_id INTEGER PRIMARY KEY AUTOINCREMENT, category_name TEXT UNIQUE NOT NULL, description TEXT
    );
    CREATE TABLE IF NOT EXISTS brand (
      brand_id INTEGER PRIMARY KEY AUTOINCREMENT, brand_name TEXT UNIQUE NOT NULL, country_of_origin TEXT
    );
    CREATE TABLE IF NOT EXISTS product_condition (
      condition_id INTEGER PRIMARY KEY AUTOINCREMENT, condition_name TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS shoe_size (
      size_id INTEGER PRIMARY KEY AUTOINCREMENT, size_system TEXT NOT NULL, size_value REAL NOT NULL,
      UNIQUE(size_system, size_value)
    );
    CREATE TABLE IF NOT EXISTS payment_method (
      method_id INTEGER PRIMARY KEY AUTOINCREMENT, method_name TEXT UNIQUE NOT NULL, is_active INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS product (
      product_id INTEGER PRIMARY KEY AUTOINCREMENT, product_name TEXT NOT NULL, category_id INTEGER NOT NULL,
      brand_id INTEGER NOT NULL, condition_id INTEGER NOT NULL, selling_price REAL NOT NULL CHECK(selling_price >= 0),
      is_active INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (category_id) REFERENCES category(category_id), FOREIGN KEY (brand_id) REFERENCES brand(brand_id),
      FOREIGN KEY (condition_id) REFERENCES product_condition(condition_id)
    );
    CREATE TABLE IF NOT EXISTS product_variant (
      variant_id INTEGER PRIMARY KEY AUTOINCREMENT, product_id INTEGER NOT NULL, size_id INTEGER NOT NULL,
      sku TEXT UNIQUE NOT NULL, FOREIGN KEY (product_id) REFERENCES product(product_id) ON DELETE CASCADE,
      FOREIGN KEY (size_id) REFERENCES shoe_size(size_id)
    );
    CREATE TABLE IF NOT EXISTS inventory (
      variant_id INTEGER PRIMARY KEY, stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK(stock_quantity >= 0),
      reorder_level INTEGER NOT NULL DEFAULT 1, last_updated TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (variant_id) REFERENCES product_variant(variant_id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS sales_transaction (
      sale_id INTEGER PRIMARY KEY AUTOINCREMENT, sale_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      user_id INTEGER NOT NULL, customer_id INTEGER, order_discount REAL NOT NULL DEFAULT 0,
      sale_status TEXT NOT NULL, FOREIGN KEY (user_id) REFERENCES user_account(user_id),
      FOREIGN KEY (customer_id) REFERENCES customer(customer_id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS sales_item (
      sale_item_id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, variant_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price REAL NOT NULL CHECK(unit_price >= 0),
      line_discount REAL NOT NULL DEFAULT 0,
      FOREIGN KEY (sale_id) REFERENCES sales_transaction(sale_id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variant(variant_id)
    );
    CREATE TABLE IF NOT EXISTS payment (
      payment_id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, method_id INTEGER NOT NULL,
      payment_date TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, amount_paid REAL NOT NULL CHECK(amount_paid >= 0),
      reference_number TEXT, payment_status TEXT NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales_transaction(sale_id), FOREIGN KEY (method_id) REFERENCES payment_method(method_id)
    );
    CREATE TABLE IF NOT EXISTS purchase_order (
      purchase_order_id INTEGER PRIMARY KEY AUTOINCREMENT, supplier_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
      order_date TEXT NOT NULL, expected_date TEXT, received_date TEXT, po_status TEXT NOT NULL,
      FOREIGN KEY (supplier_id) REFERENCES supplier(supplier_id), FOREIGN KEY (user_id) REFERENCES user_account(user_id)
    );
    CREATE TABLE IF NOT EXISTS purchase_order_item (
      purchase_order_item_id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_order_id INTEGER NOT NULL,
      variant_id INTEGER NOT NULL, quantity_ordered INTEGER NOT NULL, quantity_received INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL, FOREIGN KEY (purchase_order_id) REFERENCES purchase_order(purchase_order_id) ON DELETE CASCADE,
      FOREIGN KEY (variant_id) REFERENCES product_variant(variant_id)
    );
  `);

  db.prepare('INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (1,?,?)').run('Admin', 'Full system access');
  db.prepare('INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (2,?,?)').run('Customer', 'Store customer account');
  db.prepare('INSERT OR IGNORE INTO role (role_id,role_name,role_description) VALUES (3,?,?)').run('Cashier', 'Sales and payment processing');
  const adminHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'Yojinn', 12);
  db.prepare(`INSERT OR IGNORE INTO user_account (username,password_hash,first_name,last_name,role_id)
              VALUES (?,?,?,?,1)`).run('admin', adminHash, 'Jay Footware', 'Admin');
  const cashierHash = bcrypt.hashSync(process.env.CASHIER_PASSWORD || 'Cashier123!', 12);
  const cashiers = [
    ['cashier01','Maria','Lopez'], ['cashier02','John','Ramos'], ['cashier03','Angela','Torres'],
    ['cashier04','Carlo','Mendoza'], ['cashier05','Bea','Navarro']
  ];
  const addCashier = db.prepare(`INSERT OR IGNORE INTO user_account
    (username,password_hash,first_name,last_name,role_id,account_status) VALUES (?,?,?,?,3,'Active')`);
  cashiers.forEach(row => addCashier.run(row[0],cashierHash,row[1],row[2]));

  ['Sneakers','Skate Shoes','Lifestyle Shoes'].forEach((name, i) => db.prepare('INSERT OR IGNORE INTO category (category_id,category_name,description) VALUES (?,?,?)').run(i+1,name,'Pre-loved ukay-ukay footwear'));
  const brands = [['Nike','United States'],['Vans','United States'],['Adidas','Germany'],['Converse','United States'],['Reebok','United Kingdom'],['New Balance','United States']];
  brands.forEach((r,i) => db.prepare('INSERT OR IGNORE INTO brand (brand_id,brand_name,country_of_origin) VALUES (?,?,?)').run(i+1,...r));
  ['Excellent','Very Good','Good'].forEach((name,i) => db.prepare('INSERT OR IGNORE INTO product_condition (condition_id,condition_name) VALUES (?,?)').run(i+1,name));
  [9,8,10,7,9.5,8.5].forEach((size,i) => db.prepare('INSERT OR IGNORE INTO shoe_size (size_id,size_system,size_value) VALUES (?,?,?)').run(i+1,'US',size));
  [['Cash on Delivery',1],['GCash',1],['Bank Transfer',1]].forEach((r,i) => db.prepare('INSERT OR IGNORE INTO payment_method (method_id,method_name,is_active) VALUES (?,?,?)').run(i+1,...r));

  const products = [
    ['Air Max 90',1,1,1,1850,'JF-001',1,1], ['Old Skool',2,2,2,1200,'JF-002',2,2],
    ['Superstar',1,3,3,1450,'JF-003',3,1], ['Chuck 70 High',1,4,1,1650,'JF-004',4,1],
    ['Classic Leather',3,5,2,1350,'JF-005',5,3], ['574 Core',3,6,3,1550,'JF-006',6,1]
  ];
  const seedProduct = db.transaction(row => {
    const [name,categoryId,brandId,conditionId,price,sku,sizeId,stock] = row;
    db.prepare('INSERT OR IGNORE INTO product (product_id,product_name,category_id,brand_id,condition_id,selling_price) VALUES ((SELECT COALESCE(MAX(product_id),0)+1 FROM product),?,?,?,?,?)').run(name,categoryId,brandId,conditionId,price);
    const product = db.prepare('SELECT product_id FROM product WHERE product_name=? AND brand_id=?').get(name,brandId);
    db.prepare('INSERT OR IGNORE INTO product_variant (product_id,size_id,sku) VALUES (?,?,?)').run(product.product_id,sizeId,sku);
    const variant = db.prepare('SELECT variant_id FROM product_variant WHERE sku=?').get(sku);
    db.prepare('INSERT OR IGNORE INTO inventory (variant_id,stock_quantity,reorder_level) VALUES (?,?,1)').run(variant.variant_id,stock);
  });
  products.forEach(seedProduct);

  const customers = [
    ['Mika','Santos','mika@example.com','Davao City','Davao del Sur','2026-05-18'],
    ['Paolo','Cruz','paolo@example.com','Tagum City','Davao del Norte','2026-06-03'],
    ['Lara','Reyes','lara@example.com','Digos City','Davao del Sur','2026-06-21'],
    ['Ken','Flores','ken@example.com','Panabo City','Davao del Norte','2026-07-09'],
    ['Ana','Lim','ana@example.com','Cebu City','Cebu','2026-08-01']
  ];
  customers.forEach((r,i) => {
    db.prepare('INSERT OR IGNORE INTO customer (customer_id,first_name,last_name,email_address) VALUES (?,?,?,?)').run(i+1,r[0],r[1],r[2]);
    db.prepare('INSERT OR IGNORE INTO customer_address (address_id,customer_id,address_type,city,province) VALUES (?,?,\'Shipping\',?,?)').run(i+1,i+1,r[3],r[4]);
  });
  const admin = db.prepare("SELECT user_id FROM user_account WHERE username='admin'").get();
  const orderSeed = [
    [1,1,'Completed','2026-08-10',1,1850],[2,2,'Processing','2026-08-11',2,1200],
    [3,3,'Shipped','2026-08-12',3,1450],[4,4,'Completed','2026-08-13',4,1650],[5,5,'Processing','2026-08-14',5,1350]
  ];
  orderSeed.forEach((r,i) => {
    db.prepare('INSERT OR IGNORE INTO sales_transaction (sale_id,sale_date,user_id,customer_id,sale_status) VALUES (?,?,?,?,?)').run(i+1,r[3],admin.user_id,r[0],r[2]);
    db.prepare('INSERT OR IGNORE INTO sales_item (sale_item_id,sale_id,variant_id,quantity,unit_price) VALUES (?,?,?,?,?)').run(i+1,i+1,r[1],1,r[5]);
    db.prepare('INSERT OR IGNORE INTO payment (payment_id,sale_id,method_id,payment_date,amount_paid,payment_status) VALUES (?,?,?,?,?,?)').run(i+1,i+1,1,r[3],r[5],r[2]==='Completed'?'Paid':'Pending');
  });
  const suppliers = [
    ['Mindanao Shoe Finds','R. Garcia','09170000000','mindanao@example.com','Davao City','Davao del Sur'],
    ['Metro Sneaker Hub','L. Santos','09171111111','metro@example.com','Makati City','Metro Manila'],
    ['Cebu Preloved Kicks','J. Lim','09172222222','cebu@example.com','Cebu City','Cebu'],
    ['North Sole Trading','A. Cruz','09173333333','northsole@example.com','Baguio City','Benguet'],
    ['South Pair Supply','M. Reyes','09174444444','southpair@example.com','General Santos City','South Cotabato']
  ];
  suppliers.forEach((row,i) => {
    db.prepare("INSERT OR IGNORE INTO supplier (supplier_id,supplier_name,contact_person,phone_number,email_address,supplier_status) VALUES (?,?,?,?,?,'Active')").run(i+1,row[0],row[1],row[2],row[3]);
    db.prepare("INSERT OR IGNORE INTO supplier_address (address_id,supplier_id,city,province) VALUES (?,?,?,?)").run(i+1,i+1,row[4],row[5]);
  });
  db.prepare("INSERT OR IGNORE INTO purchase_order (purchase_order_id,supplier_id,user_id,order_date,expected_date,po_status) VALUES (1,1,?,'2026-08-01','2026-08-08','Received')").run(admin.user_id);
  db.prepare('INSERT OR IGNORE INTO purchase_order_item (purchase_order_item_id,purchase_order_id,variant_id,quantity_ordered,quantity_received,unit_cost) VALUES (1,1,1,2,2,900)').run();
}
initDatabase();

const productQuery = `SELECT pv.sku, p.product_name AS name, b.brand_name AS brand,
  ss.size_system || ' ' || CAST(ss.size_value AS TEXT) AS size, pc.condition_name AS condition,
  p.selling_price AS price, i.stock_quantity AS stock
  FROM product p JOIN brand b ON b.brand_id=p.brand_id
  JOIN product_condition pc ON pc.condition_id=p.condition_id
  JOIN product_variant pv ON pv.product_id=p.product_id
  JOIN shoe_size ss ON ss.size_id=pv.size_id JOIN inventory i ON i.variant_id=pv.variant_id
  WHERE p.is_active=1 ORDER BY p.product_id`;
const orderQuery = `SELECT 'ORD-' || printf('%04d',st.sale_id+1000) AS order_no,
  c.first_name || ' ' || c.last_name AS customer_name, p.product_name AS item,
  (si.quantity*si.unit_price)-si.line_discount-st.order_discount AS total,
  st.sale_status AS status, date(st.sale_date) AS order_date
  FROM sales_transaction st JOIN customer c ON c.customer_id=st.customer_id
  JOIN sales_item si ON si.sale_id=st.sale_id JOIN product_variant pv ON pv.variant_id=si.variant_id
  JOIN product p ON p.product_id=pv.product_id ORDER BY st.sale_id`;
const customerQuery = `SELECT 'CUS-' || printf('%03d',c.customer_id) AS customer_no,
  c.first_name || ' ' || c.last_name AS name, c.email_address AS email,
  COALESCE(ca.city,'—') AS city, COUNT(st.sale_id) AS orders_count,
  COALESCE(MIN(date(st.sale_date)),date('now')) AS joined_date
  FROM customer c LEFT JOIN customer_address ca ON ca.customer_id=c.customer_id
  LEFT JOIN sales_transaction st ON st.customer_id=c.customer_id
  GROUP BY c.customer_id ORDER BY c.customer_id`;
const supplierQuery = `SELECT 'SUP-' || printf('%03d',s.supplier_id) AS supplier_no,
  s.supplier_name AS name, s.contact_person, s.phone_number AS contact,
  s.email_address AS email, COALESCE(sa.city || ', ' || sa.province,'—') AS location,
  s.supplier_status AS status FROM supplier s
  LEFT JOIN supplier_address sa ON sa.supplier_id=s.supplier_id ORDER BY s.supplier_id`;
const cashierQuery = `SELECT 'USR-' || printf('%03d',ua.user_id) AS user_no, ua.username,
  ua.first_name || ' ' || ua.last_name AS name, r.role_name AS role,
  ua.account_status AS status, date(ua.created_at) AS created_date
  FROM user_account ua JOIN role r ON r.role_id=ua.role_id
  WHERE r.role_name='Cashier' ORDER BY ua.user_id`;

function safeUser(row) { return row && { id:row.user_id, username:row.username, email:row.email_address || null, fullName:`${row.first_name} ${row.last_name}`.trim(), role:row.role_name.toLowerCase() }; }
function getUser(where, ...values) { return db.prepare(`SELECT ua.*,r.role_name,c.email_address FROM user_account ua JOIN role r ON r.role_id=ua.role_id LEFT JOIN customer c ON c.customer_id=ua.customer_id WHERE ${where}`).get(...values); }
function requireAdmin(req,res,next) { if (!req.session.user || req.session.user.role!=='admin') return res.status(403).json({error:'Admin access is required.'}); next(); }

app.get('/api/config',(_req,res)=>res.json({googleClientId:process.env.GOOGLE_CLIENT_ID||null}));
app.get('/api/products',(_req,res)=>res.json(db.prepare(productQuery).all()));
app.get('/api/auth/me',(req,res)=>res.json({user:req.session.user||null}));
app.post('/api/auth/signup',authLimiter,async(req,res)=>{
  const {fullName,username,email,password}=req.body;
  if (![fullName,username,email,password].every(v=>typeof v==='string'&&v.trim())) return res.status(400).json({error:'All fields are required.'});
  if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) return res.status(400).json({error:'Username must be 3–24 letters, numbers, or underscores.'});
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'Enter a valid email address.'});
  if (password.length<8) return res.status(400).json({error:'Password must have at least 8 characters.'});
  const parts=fullName.trim().split(/\s+/); const firstName=parts.shift(); const lastName=parts.join(' ')||'Customer';
  try { const hash=await bcrypt.hash(password,12); let userId;
    db.transaction(()=>{ const customer=db.prepare('INSERT INTO customer (first_name,last_name,email_address) VALUES (?,?,?)').run(firstName,lastName,email.trim().toLowerCase()); userId=db.prepare('INSERT INTO user_account (username,password_hash,customer_id,first_name,last_name,role_id) VALUES (?,?,?,?,?,2)').run(username.trim(),hash,customer.lastInsertRowid,firstName,lastName).lastInsertRowid; })();
    req.session.user=safeUser(getUser('ua.user_id=?',userId)); res.status(201).json({user:req.session.user});
  } catch(err){ if(String(err.message).includes('UNIQUE')) return res.status(409).json({error:'That username or email is already registered.'}); res.status(500).json({error:'Unable to create account.'}); }
});
app.post('/api/auth/login',authLimiter,async(req,res)=>{
  const login=String(req.body.login||'').trim(); const row=getUser('ua.username=? OR c.email_address=?',login,login.toLowerCase());
  if(!row||!row.password_hash||!(await bcrypt.compare(String(req.body.password||''),row.password_hash))) return res.status(401).json({error:'Incorrect username/email or password.'});
  req.session.regenerate(err=>{ if(err)return res.status(500).json({error:'Unable to start session.'}); req.session.user=safeUser(row); res.json({user:req.session.user}); });
});
app.post('/api/auth/google',authLimiter,async(req,res)=>{
  if(!process.env.GOOGLE_CLIENT_ID)return res.status(503).json({error:'Google sign-in has not been configured yet.'});
  try { const ticket=await googleClient.verifyIdToken({idToken:req.body.credential,audience:process.env.GOOGLE_CLIENT_ID}); const p=ticket.getPayload(); if(!p.email_verified)return res.status(401).json({error:'Google email is not verified.'});
    let row=getUser('ua.google_id=? OR c.email_address=?',p.sub,p.email.toLowerCase());
    if(!row){ const names=(p.name||'Google Customer').split(/\s+/); const first=names.shift(),last=names.join(' ')||'Customer'; let username=p.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g,'').slice(0,18)||'googleuser'; while(getUser('ua.username=?',username))username+=Math.floor(Math.random()*10); let id; db.transaction(()=>{const c=db.prepare('INSERT INTO customer (first_name,last_name,email_address) VALUES (?,?,?)').run(first,last,p.email.toLowerCase()); id=db.prepare('INSERT INTO user_account (username,customer_id,first_name,last_name,role_id,google_id) VALUES (?,?,?,?,2,?)').run(username,c.lastInsertRowid,first,last,p.sub).lastInsertRowid;})(); row=getUser('ua.user_id=?',id);}
    else if(!row.google_id){db.prepare('UPDATE user_account SET google_id=? WHERE user_id=?').run(p.sub,row.user_id);}
    req.session.user=safeUser(row); res.json({user:req.session.user});
  }catch(_e){res.status(401).json({error:'Google sign-in could not be verified.'});}
});
app.post('/api/auth/logout',(req,res)=>req.session.destroy(()=>{res.clearCookie('connect.sid');res.json({ok:true});}));
app.get('/api/admin/records',requireAdmin,(_req,res)=>res.json({
  products:db.prepare(productQuery).all(),
  orders:db.prepare(orderQuery).all(),
  customers:db.prepare(customerQuery).all(),
  suppliers:db.prepare(supplierQuery).all(),
  cashiers:db.prepare(cashierQuery).all()
}));
app.get('/api/admin/management',requireAdmin,(_req,res)=>{
  const inventory=db.prepare(`SELECT pv.variant_id,pv.sku,p.product_name,b.brand_name,ss.size_system||' '||CAST(ss.size_value AS TEXT) size,
    i.stock_quantity,i.reorder_level,i.last_updated FROM inventory i JOIN product_variant pv ON pv.variant_id=i.variant_id
    JOIN product p ON p.product_id=pv.product_id JOIN brand b ON b.brand_id=p.brand_id JOIN shoe_size ss ON ss.size_id=pv.size_id ORDER BY p.product_id`).all();
  const users=db.prepare(`SELECT ua.user_id,ua.username,ua.first_name||' '||ua.last_name name,r.role_name role,
    ua.account_status status,date(ua.created_at) created_date FROM user_account ua JOIN role r ON r.role_id=ua.role_id ORDER BY ua.user_id`).all();
  const purchaseOrders=db.prepare(`SELECT po.purchase_order_id AS po_no,s.supplier_name,po.order_date,po.expected_date,
    po.received_date,po.po_status,COALESCE(SUM(poi.quantity_ordered*poi.unit_cost),0) total
    FROM purchase_order po JOIN supplier s ON s.supplier_id=po.supplier_id
    LEFT JOIN purchase_order_item poi ON poi.purchase_order_id=po.purchase_order_id GROUP BY po.purchase_order_id ORDER BY po.purchase_order_id DESC`).all();
  const sales=db.prepare(orderQuery).all();
  const customers=db.prepare(customerQuery).all();
  const suppliers=db.prepare(supplierQuery).all();
  res.json({inventory,users,purchaseOrders,sales,customers,suppliers,summary:{
    products:db.prepare('SELECT COUNT(*) count FROM product WHERE is_active=1').get().count,
    stock:db.prepare('SELECT COALESCE(SUM(stock_quantity),0) count FROM inventory').get().count,
    lowStock:db.prepare('SELECT COUNT(*) count FROM inventory WHERE stock_quantity<=reorder_level').get().count,
    salesTotal:db.prepare('SELECT COALESCE(SUM(quantity*unit_price-line_discount),0) total FROM sales_item').get().total
  }});
});
app.patch('/api/admin/inventory/:id',requireAdmin,(req,res)=>{
  const quantity=Number(req.body.stockQuantity);
  if(!Number.isInteger(quantity)||quantity<0)return res.status(400).json({error:'Stock quantity must be a non-negative whole number.'});
  const result=db.prepare("UPDATE inventory SET stock_quantity=?,last_updated=CURRENT_TIMESTAMP WHERE variant_id=?").run(quantity,req.params.id);
  if(!result.changes)return res.status(404).json({error:'Inventory item not found.'});
  res.json({ok:true,stockQuantity:quantity});
});
app.post('/api/admin/purchase-orders/:id/receive',requireAdmin,(req,res)=>{
  try { db.transaction(()=>{
    const po=db.prepare('SELECT * FROM purchase_order WHERE purchase_order_id=?').get(req.params.id);
    if(!po)throw new Error('NOT_FOUND'); if(po.po_status==='Received')throw new Error('ALREADY_RECEIVED');
    const items=db.prepare('SELECT * FROM purchase_order_item WHERE purchase_order_id=?').all(req.params.id);
    items.forEach(item=>{const add=item.quantity_ordered-item.quantity_received;if(add>0)db.prepare("UPDATE inventory SET stock_quantity=stock_quantity+?,last_updated=CURRENT_TIMESTAMP WHERE variant_id=?").run(add,item.variant_id);});
    db.prepare('UPDATE purchase_order_item SET quantity_received=quantity_ordered WHERE purchase_order_id=?').run(req.params.id);
    db.prepare("UPDATE purchase_order SET po_status='Received',received_date=date('now') WHERE purchase_order_id=?").run(req.params.id);
  })(); res.json({ok:true}); } catch(err){if(err.message==='NOT_FOUND')return res.status(404).json({error:'Purchase order not found.'});if(err.message==='ALREADY_RECEIVED')return res.status(409).json({error:'This order was already received.'});res.status(500).json({error:'Unable to record delivery.'});}
});
app.get('/api/admin/schema-status',requireAdmin,(_req,res)=>{ const tables=['user_account','role','customer','customer_address','supplier','supplier_address','category','brand','product_condition','shoe_size','payment_method','product','product_variant','inventory','sales_transaction','sales_item','payment','purchase_order','purchase_order_item']; res.json({connected:true,database:'SQLite (normalized ERD implementation)',tables:tables.map(name=>({name,records:db.prepare(`SELECT COUNT(*) count FROM ${name}`).get().count}))}); });
app.use('/api',(_req,res)=>res.status(404).json({error:'API endpoint not found.'}));
app.use((_req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,'0.0.0.0',()=>console.log(`Jay Footware is running at http://localhost:${PORT}`));
