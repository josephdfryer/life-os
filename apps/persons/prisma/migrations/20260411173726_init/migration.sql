-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "first" TEXT NOT NULL,
    "last" TEXT NOT NULL,
    "headline" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "birthday" TEXT,
    "closeness" INTEGER NOT NULL DEFAULT 2,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "values" TEXT NOT NULL DEFAULT '[]',
    "notes" TEXT,
    "color" TEXT,
    "colorSoft" TEXT
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "placeId" TEXT,
    "notes" TEXT,
    "transcript" TEXT,
    "metadata" TEXT,
    CONSTRAINT "Event_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Interaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT NOT NULL,
    "eventId" TEXT,
    "type" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL,
    "duration" INTEGER,
    "emotionalWeight" TEXT,
    "outcome" TEXT,
    "summary" TEXT,
    "notes" TEXT,
    "actionItems" TEXT,
    "billable" BOOLEAN NOT NULL DEFAULT false,
    "amount" REAL,
    "direction" TEXT,
    "sourceFileId" TEXT,
    CONSTRAINT "Interaction_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Interaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Interaction_sourceFileId_fkey" FOREIGN KEY ("sourceFileId") REFERENCES "ImportedFile" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Plan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "personId" TEXT,
    "text" TEXT NOT NULL,
    "timescale" TEXT,
    "successSignals" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parentId" TEXT,
    CONSTRAINT "Plan_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Plan_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Plan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "type" TEXT,
    "address" TEXT,
    "coordinates" TEXT,
    "meaning" TEXT
);

-- CreateTable
CREATE TABLE "ImportedFile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "filename" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL
);
