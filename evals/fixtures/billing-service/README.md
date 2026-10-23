# billing-service

Turns customer orders into numbered invoices. Prices come from a tiered catalog, discounts stack under rules,
tax depends on the shipping region and product category, and every amount is kept in minor units of the
invoice currency until the final document is rendered.
