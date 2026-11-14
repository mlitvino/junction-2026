# Valio Aimo — Trusted Trade Agents

There is two main source of information:

- User prompt (I want 440 kg of creamy cheese)  
- Valio Aimo products (We have X and Y in quantity of J and K, with delivery time of D and T, and price of P and A)

And three additional sources:

- Saved Customers\` preferences (Agent permissions, budget limits, allergens and nutrition values)  
- Customers\` inventory (Restaurant, School canteen, etc)  
- Recipe list (Customer provided recipe, trusted Valio recipe book or Database) 

# Core features

These support the challenge's three mandatory capabilities: (1) product, price and availability lookup; (2) inquiry → order using fixed prices; and (3) agent permissions and human approval.

1. **Connect to the synthetic backend** — Easy. Set up authentication and API clients for Valio Aimo's mock catalog and ordering systems.  
2. **Structured product search** — Easy. Search by product name, category, and relevant attributes; return machine-readable results.  
3. **Price and availability lookup** — Easy. Fetch current fixed prices, units, and available quantities from the mock APIs.  
4. **Requirement-based filtering** — Easy–Medium. Match buyer constraints such as product type, quantity, dietary attributes, and budget.  
5. **Price-and-availability inquiry** — Medium. Define a request/response step that confirms what can be ordered at what fixed price before commitment.  
6. **Product comparison and selection** — Medium. Compare valid offers and pick an option that meets the buyer's stated requirements.  
7. **Order preview and validation** — Medium. Build an order summary with product IDs, quantities, prices, totals, and checks before submission.  
8. **Order placement** — Medium. Submit an authorized order to the mock backend and display the returned status/confirmation.  
9. **Agent permission rules (guardrails)** — Medium. Enforce purchasing authority, such as spending limits and restrictions on permitted products.  
10. **Human approval workflow** — Medium–Hard. Pause unauthorized orders, request sign-off, and continue or reject based on the human decision.  
11. **Open, documented agent interface** — Medium–Hard. Expose the interaction through a structured, documented interface usable by an external purchasing agent (for example, an API or MCP-style tools).  
12. **End-to-end autonomous purchasing flow** — Hard. Demonstrate request → search → compare → inquiry → permission check → approval if needed → order, including interpreting a buyer's request.

# Optional features

These are suggested directions and example scenarios in the challenge, not mandatory features. They can improve the demo and judging performance.

1. **Human-readable audit trail** — Medium. Log what the agent searched, selected, ordered, and why, including approvals.  
2. **Delivery comparison** — Medium. Compare lead times and delivery reliability against the requested deadline.  
3. **Sustainability comparison** — Medium. Compare certificates and sustainability labels already present in the mock data.  
4. **Partial availability handling** — Medium–Hard. Detect insufficient stock and propose feasible quantities or combinations.  
5. **Product substitution and ranking** — Hard. Recommend good/better/best alternatives within Valio Aimo's assortment and explain trade-offs.  
6. **Trust and verification layer** — Hard. Provide verifiable evidence for stock, price, or origin claims using an open approach.  
7. **Category-level carbon-footprint comparison** — Hard. Compare estimated footprint ranges where synthetic data supports them; explicitly a stretch goal.  
8. **Allergen-safe substitution** — Hard. Enforce dietary, allergen, and nutrition constraints when replacing an unavailable item.  
9. **Recipe-to-order workflow** — Very Hard. Translate a menu or recipe into ingredient needs, subtract existing stock, and order the remainder.  
10. **Proactive supplier-stock-out response** — Very Hard. Detect a shortage and propose recipe-compatible replacements before the buyer notices.  
11. **Recurring-order anomaly detection** — Very Hard. Detect unusual changes in quantities or costs before automatically repeating an order.  
12. **Proactive product recommendations** — Very Hard. Enable a supplier-side agent to suggest seasonal or newly available products to a buyer agent.

Scope: Build against synthetic APIs and data. The challenge does not require building a marketplace, accessing production systems, or implementing agentic payments.

# User Stories

Provided in implementation importance

## Simple buy X of Y quantity (Easy)

Customers prompt an agent to buy certain products in specified quantities.

Agent steps:

1. Extract data from prompt in format \[Product name\] \- \[Product type\] \- \[Quantity\]  
2. API request to get a list of products by \[Product type\]  
3. Create a sorted list of best match by \[Product name\]  
4. Remove entries that don't match with Customer preferences (Dietary restrictions, Allergens, Nutritions)  
5. If data about previous orders is available, sort by product, brand.  
6. Compare prices to customer budget  
7. Create an order  
8. Ask for customer approval or changes in order like: change product X on product Y   
9. Checkout order and provide receipt

## Order products based on customer reciep (Medium)

Customer have receipts and inventory system integration. When customer needs to order products for some specific dish.

Pre-requisits:
1. Mock receipt data for salmon soup
2. Mock data about some inventory ingredients stock

Agents steps:
1. Query data from receipt in format \[Product name\] \- \[Product type\] \- \[Quantity\]
2. Calculate total quantity for each item
3. Caclulate actually needed = total needed - inventory stock 
4. API request to get a list of products by \[Product type\]  
5. Create a sorted list of best match by \[Product name\]  
6. Remove entries that don't match with Customer preferences (Dietary restrictions, Allergens, Nutritions)  
7. If data about previous orders is available, sort by product, brand.
8. Compare prices to customer budget
9. Create an order  
10. Ask for customer approval or changes in order like: change product X on product Y   
11. Checkout order and provide receipt
