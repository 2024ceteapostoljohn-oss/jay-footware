# Jay Footwear — Corrected ERD Notes

## Final model totals

- **19 entities/tables**
- **20 foreign-key columns**
- **4 login roles:** Administrator, Customer, Cashier, Owner/Manager
- **1 external managed entity:** Supplier (no direct login)
- **3 conceptual many-to-many relationships**, resolved using associative entities

## Corrections applied

1. Added `USER_ACCOUNT.CustomerID` as a nullable foreign key to `CUSTOMER`.
2. Added nullable, unique `USER_ACCOUNT.GoogleID` for optional Google authentication.
3. Added `PRODUCT.ImagePath` for storefront product photographs.
4. Marked `SALES_TRANSACTION.CustomerID` nullable to support walk-in customers.
5. Included Owner/Manager in the `ROLE` seed values.
6. Corrected entity total from 18 to 19.
7. Corrected foreign-key total to 20.
8. Added explicit primary keys, foreign keys, unique constraints and checks.
9. Added composite uniqueness to `PRODUCT_VARIANT`, `SALES_ITEM` and `PURCHASE_ORDER_ITEM`.
10. Clarified that the Task 6 physical model uses Oracle-compatible types while the portable Node.js prototype implements equivalent SQLite types.

## Main relationship cardinalities

| Parent | Child | Cardinality | Notes |
|---|---|---:|---|
| ROLE | USER_ACCOUNT | 1:M | Every account has one role |
| CUSTOMER | USER_ACCOUNT | 1:0..1 | Only customer accounts use CustomerID |
| CUSTOMER | CUSTOMER_ADDRESS | 1:M | Customer may keep multiple addresses |
| SUPPLIER | SUPPLIER_ADDRESS | 1:M | Supplier may keep multiple addresses |
| CATEGORY | PRODUCT | 1:M | Product belongs to one category |
| BRAND | PRODUCT | 1:M | Product belongs to one brand |
| PRODUCT_CONDITION | PRODUCT | 1:M | Product has one condition grade |
| PRODUCT | PRODUCT_VARIANT | 1:M | Product can have several size variants |
| SHOE_SIZE | PRODUCT_VARIANT | 1:M | A size can be used by many products |
| PRODUCT_VARIANT | INVENTORY | 1:1 | Shared key; one stock record per variant |
| USER_ACCOUNT | SALES_TRANSACTION | 1:M | Cashier/user processes many sales |
| CUSTOMER | SALES_TRANSACTION | 1:0..M | Customer is optional for walk-in sales |
| SALES_TRANSACTION | SALES_ITEM | 1:M | Sale contains one or more items |
| PRODUCT_VARIANT | SALES_ITEM | 1:M | Variant may appear in many sales |
| SALES_TRANSACTION | PAYMENT | 1:M | Supports payment records per sale |
| PAYMENT_METHOD | PAYMENT | 1:M | Each payment uses one method |
| SUPPLIER | PURCHASE_ORDER | 1:M | Supplier receives many purchase orders |
| USER_ACCOUNT | PURCHASE_ORDER | 1:M | Admin/user creates purchase orders |
| PURCHASE_ORDER | PURCHASE_ORDER_ITEM | 1:M | Purchase order contains line items |
| PRODUCT_VARIANT | PURCHASE_ORDER_ITEM | 1:M | Variant may appear in many purchase orders |

## Resolved many-to-many relationships

1. `PRODUCT` ↔ `SHOE_SIZE`, resolved by `PRODUCT_VARIANT`.
2. `SALES_TRANSACTION` ↔ `PRODUCT_VARIANT`, resolved by `SALES_ITEM`.
3. `PURCHASE_ORDER` ↔ `PRODUCT_VARIANT`, resolved by `PURCHASE_ORDER_ITEM`.

## Files

- `Jay-Footwear-Corrected-ERD.drawio` — editable diagrams.net file
- `Jay-Footwear-Corrected-Oracle-DDL.sql` — Oracle 12c+ table and constraint definitions
- `Jay-Footwear-Corrected-ERD-Notes.md` — correction summary and cardinalities
