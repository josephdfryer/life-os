CREATE TABLE "SupplierProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "supplierCode" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "paymentTerms" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SupplierProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SupplierProfile_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "orderedAt" DATETIME NOT NULL,
    "expectedAt" DATETIME,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PurchaseOrder_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "SupplierProfile" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PurchaseOrderLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchaseOrderId" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "descriptionSnapshot" TEXT NOT NULL,
    "skuSnapshot" TEXT,
    "orderedQuantity" REAL NOT NULL,
    "unitCost" INTEGER,
    "destinationPlaceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseOrderLine_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "ItemDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseOrderLine_destinationPlaceId_fkey" FOREIGN KEY ("destinationPlaceId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PurchaseReceiptLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "orderLineId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "lotId" TEXT,
    "quantity" REAL NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PurchaseReceiptLine_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReceiptLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReceiptLine_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "PurchaseOrderLine" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReceiptLine_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PurchaseReceiptLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "InventoryLot" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SupplierProfile_groupId_key" ON "SupplierProfile"("groupId");
CREATE UNIQUE INDEX "SupplierProfile_workspaceId_supplierCode_key" ON "SupplierProfile"("workspaceId", "supplierCode");
CREATE INDEX "SupplierProfile_workspaceId_active_idx" ON "SupplierProfile"("workspaceId", "active");
CREATE UNIQUE INDEX "PurchaseOrder_planId_key" ON "PurchaseOrder"("planId");
CREATE UNIQUE INDEX "PurchaseOrder_workspaceId_orderNumber_key" ON "PurchaseOrder"("workspaceId", "orderNumber");
CREATE INDEX "PurchaseOrder_workspaceId_orderedAt_idx" ON "PurchaseOrder"("workspaceId", "orderedAt");
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");
CREATE INDEX "PurchaseOrderLine_purchaseOrderId_idx" ON "PurchaseOrderLine"("purchaseOrderId");
CREATE INDEX "PurchaseOrderLine_definitionId_idx" ON "PurchaseOrderLine"("definitionId");
CREATE INDEX "PurchaseOrderLine_destinationPlaceId_idx" ON "PurchaseOrderLine"("destinationPlaceId");
CREATE INDEX "PurchaseReceiptLine_workspaceId_createdAt_idx" ON "PurchaseReceiptLine"("workspaceId", "createdAt");
CREATE INDEX "PurchaseReceiptLine_eventId_idx" ON "PurchaseReceiptLine"("eventId");
CREATE INDEX "PurchaseReceiptLine_orderLineId_idx" ON "PurchaseReceiptLine"("orderLineId");
CREATE INDEX "PurchaseReceiptLine_itemId_idx" ON "PurchaseReceiptLine"("itemId");
