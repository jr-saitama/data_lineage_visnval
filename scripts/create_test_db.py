
import sqlite3
import random
from datetime import datetime, timedelta
import os

# Ensure data directory exists
os.makedirs("data", exist_ok=True)

SILVER_DB = "data/dw_silver.db"
GOLD_DB = "data/dw_gold.db"

def create_silver_db():
    print(f"Creating {SILVER_DB}...")
    conn = sqlite3.connect(SILVER_DB)
    cursor = conn.cursor()

    # CUSTOMER_DIM
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS CUSTOMER_DIM (
            CUSTOMER_ID INTEGER PRIMARY KEY,
            FULL_NAME TEXT,
            CUSTOMER_TYPE TEXT,
            EMAIL TEXT,
            CREATED_DATE TEXT
        )
    """)
    
    # PRODUCTS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS PRODUCTS (
            PRODUCT_ID INTEGER PRIMARY KEY,
            PRODUCT_NAME TEXT,
            UNIT_PRICE REAL,
            CATEGORY_ID INTEGER,
            PROFIT_MARGIN REAL
        )
    """)
    
    # DISCOUNTS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS DISCOUNTS (
            DISCOUNT_ID INTEGER PRIMARY KEY,
            DISCOUNT_CODE TEXT,
            DISCOUNT_PCT REAL
        )
    """)
    
    # ORDERS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ORDERS (
            ORDER_ID INTEGER PRIMARY KEY,
            CUSTOMER_ID INTEGER,
            PRODUCT_ID INTEGER,
            DISCOUNT_ID INTEGER,
            QUANTITY INTEGER,
            ORDER_STATUS TEXT,
            ORDER_DATE TEXT
        )
    """)
    
    # SHIPMENTS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS SHIPMENTS (
            SHIPMENT_ID INTEGER PRIMARY KEY,
            ORDER_ID INTEGER,
            SHIPMENT_DATE TEXT,
            STATUS TEXT
        )
    """)

    # PAYMENTS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS PAYMENTS (
            PAYMENT_ID INTEGER PRIMARY KEY,
            ORDER_ID INTEGER,
            AMOUNT REAL,
            PAYMENT_METHOD TEXT
        )
    """)

    # WEB_CLICKS
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS WEB_CLICKS (
            CLICK_ID INTEGER PRIMARY KEY,
            SESSION_ID TEXT,
            CUSTOMER_ID INTEGER,
            PAGE_URL TEXT,
            TIMESTAMP TEXT
        )
    """)
    
    # Existing derived metrics...
    cursor.execute("CREATE TABLE IF NOT EXISTS SALES_METRICS (PRODUCT_ID INTEGER, UNITS_SOLD_YTD INTEGER)")
    cursor.execute("CREATE TABLE IF NOT EXISTS CATEGORY_DIM (CATEGORY_ID INTEGER, IS_STRATEGIC TEXT)")
    cursor.execute("CREATE TABLE IF NOT EXISTS RETURN_METRICS (PRODUCT_ID INTEGER, RETURN_RATE REAL)")
    cursor.execute("CREATE TABLE IF NOT EXISTS SALES_TRENDS (PRODUCT_ID INTEGER, SALES_TREND_PCT REAL)")
    cursor.execute("CREATE TABLE IF NOT EXISTS INVENTORY_METRICS (PRODUCT_ID INTEGER, STOCK_TURNOVER REAL, DAYS_INVENTORY_OUTSTANDING REAL)")

    # Insert Data
    customers = [
        (1, "John Doe", "VIP", "john@example.com", "2023-01-01"),
        (2, "Jane Smith", "STANDARD", "jane@example.com", "2023-02-15"),
        (3, "Bob Jones", "VIP", "bob@example.com", "2023-03-10")
    ]
    cursor.executemany("INSERT OR IGNORE INTO CUSTOMER_DIM VALUES (?,?,?,?,?)", customers)

    products = [
        (101, "Laptop", 1000.0, 1, 40.0),
        (102, "Mouse", 25.0, 2, 15.0),
        (103, "Desk", 200.0, 3, 25.0),
        (104, "Monitor", 300.0, 1, 30.0)
    ]
    cursor.executemany("INSERT OR IGNORE INTO PRODUCTS VALUES (?,?,?,?,?)", products)

    discounts = [
        (1, "NONE", 0.0),
        (2, "SUMMER10", 0.10)
    ]
    cursor.executemany("INSERT OR IGNORE INTO DISCOUNTS VALUES (?,?,?)", discounts)

    # Orders - mixed data to test validations
    orders = [
        (1001, 1, 101, 2, 1, "COMPLETED", "2024-01-01"), # 1000 * 0.9 = 900 revenue
        (1002, 2, 102, 1, 2, "COMPLETED", "2024-01-02"), # 25 * 2 = 50 revenue
        (1003, 3, 103, 1, 1, "PENDING", "2024-01-03"),   # 0 revenue (filter)
        (1004, 1, 104, 1, 1, "SHIPPED", "2024-01-04")    # 300 revenue
    ]
    cursor.executemany("INSERT OR IGNORE INTO ORDERS VALUES (?,?,?,?,?,?,?)", orders)
    
    # New Data for Expansion
    shipments = [
        (501, 1001, "2024-01-02", "DELIVERED"),
        (502, 1004, "2024-01-05", "IN_TRANSIT")
    ]
    cursor.executemany("INSERT OR IGNORE INTO SHIPMENTS VALUES (?,?,?,?)", shipments)

    payments = [
        (601, 1001, 900.0, "CREDIT_CARD"),
        (602, 1002, 50.0, "PAYPAL"),
        (603, 1004, 300.0, "CREDIT_CARD")
    ]
    cursor.executemany("INSERT OR IGNORE INTO PAYMENTS VALUES (?,?,?,?)", payments)
    
    web_clicks = [
        (701, "sess_1", 1, "/product/101", "2024-01-01 10:00:00"),
        (702, "sess_1", 1, "/checkout", "2024-01-01 10:15:00"),
        (703, "sess_2", 2, "/product/102", "2024-01-02 09:00:00")
    ]
    cursor.executemany("INSERT OR IGNORE INTO WEB_CLICKS VALUES (?,?,?,?,?)", web_clicks)

    # Derived metrics data
    cursor.execute("INSERT OR IGNORE INTO SALES_METRICS VALUES (101, 12000)")
    cursor.execute("INSERT OR IGNORE INTO SALES_METRICS VALUES (102, 500)")
    cursor.execute("INSERT OR IGNORE INTO CATEGORY_DIM VALUES (1, 'Y')")
    cursor.execute("INSERT OR IGNORE INTO CATEGORY_DIM VALUES (2, 'N')")
    cursor.execute("INSERT OR IGNORE INTO RETURN_METRICS VALUES (101, 2.5)")
    cursor.execute("INSERT OR IGNORE INTO RETURN_METRICS VALUES (102, 0.5)")
    
    conn.commit()
    conn.close()
    print("Silver DB created.")

def create_gold_db():
    print(f"Creating {GOLD_DB}...")
    conn = sqlite3.connect(GOLD_DB)
    cursor = conn.cursor()

    # ORDERS_FACT
    cursor.execute("DROP TABLE IF EXISTS ORDERS_FACT")
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ORDERS_FACT (
            ORDER_ID INTEGER PRIMARY KEY,
            CUSTOMER_ID INTEGER,
            PRODUCT_ID INTEGER,
            CUSTOMER_NAME TEXT,
            TOTAL_REVENUE REAL,
            PRODUCT_CLASSIFICATION TEXT,
            ORDER_DATE TEXT
        )
    """)
    
    # CUSTOMER_360
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS CUSTOMER_360 (
            CUSTOMER_ID INTEGER PRIMARY KEY,
            FULL_NAME TEXT,
            TOTAL_SPEND REAL,
            LAST_ORDER_DATE TEXT,
            SEGMENT TEXT
        )
    """)

    # MONTHLY_REVENUE
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS MONTHLY_REVENUE (
            MONTH TEXT,
            REVENUE REAL,
            ORDER_COUNT INTEGER
        )
    """)

    # Populating Gold with expected values according to rules
    # order 1001: VIP -> "JOHN DOE", Rev 900
    # order 1002: STANDARD -> "Jane Smith", Rev 50
    # order 1003: PENDING -> Rev 0 (if in table, but typical ETL might filter)
    
    # We will simulate valid and slight mismatch to test validation
    fact_data = [
        (1001, 1, 101, "JOHN DOE", 900.0, "PREMIUM", "2024-01-01"), # Valid
        (1002, 2, 102, "Jane Smith", 55.0, "STANDARD", "2024-01-02"), # Invalid Revenue (real 50)
        (1003, 3, 103, "Bob Jones", 0.0, "STANDARD", "2024-01-03"),    # Valid
        (1004, 1, 104, "JOHN DOE", 300.0, "STANDARD", "2024-01-04")    # Valid
    ]
    cursor.executemany("INSERT OR IGNORE INTO ORDERS_FACT VALUES (?,?,?,?,?,?,?)", fact_data)
    
    # CUSTOMER 360 Data
    # id 1: 900 + 300 = 1200
    # id 2: 50
    c360_data = [
        (1, "John Doe", 1200.0, "2024-01-04", "HIGH_VALUE"),
        (2, "Jane Smith", 50.0, "2024-01-02", "LOW_VALUE")
    ]
    cursor.executemany("INSERT OR IGNORE INTO CUSTOMER_360 VALUES (?,?,?,?,?)", c360_data)

    # Monthly Revenue
    # Jan 2024: 900 + 50 + 300 = 1250
    monthly_data = [
        ("2024-01", 1250.0, 3)
    ]
    cursor.executemany("INSERT OR IGNORE INTO MONTHLY_REVENUE VALUES (?,?,?)", monthly_data)

    conn.commit()
    conn.close()
    print("Gold DB created.")

if __name__ == "__main__":
    create_silver_db()
    create_gold_db()
