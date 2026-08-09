# Stuff Inventory Architecture

## What this adds

Inventory is a Stuff lens over the existing Life OS graph. It answers:

- Where is this Item now?
- How did it get there?
- When was it last physically observed?
- What was expected and found during a location check?

It does not add a ninth primitive.

## Model

```text
Place hierarchy
  Home → Room → Closet → Shelf
                         ↑
                    Item.placeId

Person ─┐
Item ───┼─ Interaction: item_moved ─ source Place
Event ──┤                              destination Place
Place ──┘

Event: stocktake
  ├─ frozen expected Item and Place IDs in metadata
  ├─ Interaction: inventory_verified → Item
  └─ Interaction: item_moved → unexpected Item accepted here
```

`Item.placeId` is the current-location projection. `item_moved` Interactions
are the immutable history. The inventory move command updates both in one
database transaction and rejects a stale expected source location.

Canonical Item writes pass through `@life-os/domain/items`. Its transactional
commands publish the matching `item.create`, `item.update`, `item.move`,
`item.quantity.adjust`, or `item.delete` GraphEvent in the same commit. Stuff
retains inventory policy and evidence creation, then fires the registered
`item.create` or `item.update` automation trigger only after that transaction
commits. This keeps generic Item APIs, wardrobe import, stock movement, stock
adjustment, tracking configuration, and purchase receiving on one write path
without moving inventory-specific rules into the shared primitive package.

An Item inside another Item through an active `Assembly` inherits the
container's effective Place. It cannot be moved independently until
disassembled. `Assembly` is not used for shelves, drawers, or rooms; those are
the `Place.parentPlaceId` hierarchy.

## Stocktake lifecycle

Starting a stocktake creates an `Event` with type `stocktake`. Its metadata is
a versioned JSON snapshot containing:

- the selected Place IDs;
- whether descendant Places were included;
- the Item IDs expected when the stocktake began.

Each expected scan creates one `inventory_verified` Interaction connected to
the Event, Item, observing Person, and effective Place. Repeated scans reuse
the prior observation. An unexpected Item is only moved after user
confirmation, using the normal movement command linked to the stocktake Event.

Unseen Items are derived from the frozen expected set minus observed Items.
Nothing is automatically marked missing. Explicit confirmation creates an
Item `State` whose definition is:

```text
entityType: Item
type: inventory_condition
value: missing
```

A later movement or verification supersedes that missing observation in the
derived current view without deleting history.

## Routes

| Surface | Purpose |
|---|---|
| `/inventory` | Attention, locations, scanning, and stocktakes |
| `/inventory/labels` | Printable QR label for one Item or Place |
| `/inventory/items/[id]` | Stable Item QR resolver |
| `/inventory/places/[id]` | Stable Place QR resolver |
| `GET /api/inventory/overview` | Derived inventory projection |
| `GET /api/inventory/lookup` | Resolve an Item/Place ID, asset ID, or exact name |
| `POST /api/inventory/move` | Transactional movement command |
| `POST /api/inventory/stocktakes` | Freeze and start a stocktake |
| `GET/PATCH /api/inventory/stocktakes/[id]` | Read and advance a stocktake |

The generic Item PATCH route intentionally refuses `placeId` changes so
location history cannot be bypassed.

## Storage and safety

Phase 1 uses the existing schema and creates no migration. Phase 2 adds only
the support records and edge metadata described below. All route reads and
writes are workspace-scoped. Verification uses local or isolated development
data only; no seed, reset, truncate, or bulk-delete operation is part of this
feature.

## Phase 2: stock identity and quantity

Phase 2 distinguishes a physical holding from its reusable stock identity:

```text
ItemDefinition: "Coffee beans", SKU COFFEE-1KG, unit bag
  ├─ reorder point and target stock
  ├─ tracking mode: quantity, lot, or serial
  ├─ InventoryLot: ROAST-0726, expires August 10
  └─ Item: 2 bags at Pantry
```

`ItemDefinition` and `InventoryLot` are support models, not Life OS
primitives. `Item` remains the physical object or stock holding at a Place.
This permits the same definition or manufacturer lot to have separate
holdings at different Places without pretending the catalog entry is itself a
physical object.

Existing Items do not require a definition and are not backfilled. A
lot-tracked Item must reference a Lot belonging to its Definition. A
serialized Item requires a serial number, must have quantity one, and cannot
reuse the same serial within its workspace and Definition.

### Quantity ledger

`Item.quantity` remains the current projection for fast reads. It cannot be
changed through generic Item PATCH. The stock adjustment command:

1. checks a non-zero delta and non-negative result;
2. checks the expected current quantity in the database write;
3. updates the Item balance;
4. creates an `inventory_adjusted` Interaction;
5. records `quantityDelta` and `quantityAfter` on `ItemInteraction`.

Those writes occur in one transaction. A reason is mandatory. The stored
balance can therefore be reconstructed and audited from the Item's adjustment
history after its initial quantity.

Low stock is derived by summing Item quantities for an ItemDefinition and
comparing the result with `reorderPoint`. Suggested replenishment is
`targetStock - current quantity`, never a stored field. Expired and
soon-to-expire status are likewise derived from `InventoryLot.expiresAt`; the
attention window is thirty days.

### Phase 2 routes

| Route | Purpose |
|---|---|
| `GET/POST /api/inventory/definitions` | List or create stock definitions |
| `POST /api/inventory/lots` | Create a tracked manufacturer/receiving lot |
| `PATCH /api/inventory/items/[id]/stock` | Configure tracking or record a quantity adjustment |

The `/inventory` Stock tab shows definitions, aggregate balances, thresholds,
lots, and expiry. Item detail provides definition/lot/serial configuration and
reasoned stock adjustment controls.

## Phase 3: suppliers, purchasing, and receiving

Procurement reuses the graph rather than inventing parallel business objects:

```text
Group: Acme Supply
  └─ SupplierProfile: code, contacts, payment terms

Plan: Purchase PO-2026-001 from Acme Supply
  └─ PurchaseOrder
       └─ PurchaseOrderLine → ItemDefinition

Event: Received PO-2026-001
  └─ Interaction: inventory_received
       ├─ Plan participant: purchase order
       ├─ Group participant: supplier
       ├─ Item participant: received holding
       ├─ Place participant: destination
       ├─ ItemInteraction: quantity delta and resulting balance
       └─ sourceFileId → ImportedFile receipt or packing slip
```

A Supplier is canonically a corporation `Group`. `SupplierProfile` is an
operational support record for supplier code and contact/payment details. A
purchase is canonically a `Plan`; `PurchaseOrder` and `PurchaseOrderLine`
provide order number, currency, dates, price snapshots, quantities, and
destinations. Creating the order also records a `purchase_order_placed`
Interaction between the Plan, supplier Group, and acting Person.

Receiving is a bounded `Event` with type `purchase_received`. Each accepted
line creates an `inventory_received` Interaction and a `PurchaseReceiptLine`
mapping the order line to the resulting Item quantity. Receipt lines are the
source of truth for received totals. Partial and complete status are derived,
and the purchase Plan becomes `completed` only when every line is fulfilled.
Over-receiving is rejected rather than silently changing the order.

Receiving can increment an existing Item holding only when Definition, Place,
and Lot match. Otherwise it creates a new zero-balance Item at the destination
and applies the received quantity through the same auditable ledger edge.
Lot-tracked receipts require a matching Lot. Serialized receipts require
quantity one and a serial number.

Receipt and packing-slip bytes use the storage-neutral media layer. Local
development stores them beneath `inventory/receipts/<workspace>/`; the graph
contains only the `ImportedFile` record. Its ID is written to
`Interaction.sourceFileId`, preserving direct provenance without treating the
file as a primitive.

### Phase 3 routes

| Route | Purpose |
|---|---|
| `GET /api/inventory/procurement` | Supplier and purchase-order projection |
| `POST /api/inventory/suppliers` | Create a corporation Group and SupplierProfile |
| `POST /api/inventory/purchase-orders` | Create a Purchase Plan and operational lines |
| `POST /api/inventory/purchase-orders/[id]/receive` | Receive selected quantities transactionally |
| `POST /api/inventory/receipts` | Archive a receipt or packing slip |
| `GET /api/inventory/receipts/[id]` | Read an authorized archived receipt |

The `/inventory` Purchasing tab provides supplier creation, multi-line order
entry, progress, partial receiving, lot/serial capture, destinations, and
optional receipt upload.
