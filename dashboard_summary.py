from pathlib import Path
import sqlite3

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "delivery_database.db"


def load_dashboard_data() -> dict[str, pd.DataFrame]:
    conn = sqlite3.connect(DB_PATH)
    fact = pd.read_sql_query("SELECT * FROM delivery_fact", conn)
    country = pd.read_sql_query("SELECT * FROM country_performance ORDER BY Late_Rate_pct DESC", conn)
    vendor = pd.read_sql_query("SELECT * FROM vendor_performance ORDER BY Late_Rate_pct DESC", conn)
    product = pd.read_sql_query("SELECT * FROM product_performance ORDER BY Late_Rate_pct DESC", conn)
    monthly = pd.read_sql_query("SELECT * FROM monthly_performance ORDER BY Month ASC", conn)
    conn.close()

    return {
        "fact": fact,
        "country": country,
        "vendor": vendor,
        "product": product,
        "monthly": monthly,
    }


def main():
    data = load_dashboard_data()
    fact = data["fact"]

    total_shipments = len(fact)
    late_rate = (fact["Delivery_Status"].eq("Late").mean() * 100).round(2)
    avg_delay = fact["Delivery_Delay_Days"].mean().round(2)

    top_country = data["country"].head(1).iloc[0]
    top_vendor = data["vendor"].head(1).iloc[0]

    print("Delivery Dashboard Summary")
    print("=" * 30)
    print(f"Total shipments: {total_shipments}")
    print(f"Late delivery rate: {late_rate}%")
    print(f"Average delay: {avg_delay} days")
    print(f"Highest-risk country: {top_country['Country']} ({top_country['Late_Rate_pct']}% late)")
    print(f"Highest-risk vendor: {top_vendor['Vendor']} ({top_vendor['Late_Rate_pct']}% late)")
    print("\nTop 5 countries by late rate:")
    print(data["country"].head().to_string(index=False))
    print("\nTop 5 vendors by late rate:")
    print(data["vendor"].head().to_string(index=False))
    print("\nMonthly trend preview:")
    print(data["monthly"].head(10).to_string(index=False))


if __name__ == "__main__":
    main()
