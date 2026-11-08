# Graph Report - tireflow  (2026-11-01)

## Corpus Check
- 277 files · ~161,240 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 23 file(s) not represented in the graph (top: .csv 13, .patch 3, (none) 2)

## Summary
- 1711 nodes · 6515 edges · 67 communities (61 shown, 6 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 67 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Community 0
- Community 1
- Community 2
- Community 3
- Community 4
- Community 5
- Community 6
- Community 7
- Community 8
- Community 9
- Community 10
- Community 11
- Community 12
- Community 13
- Community 14
- Community 15
- Community 16
- Community 17
- Community 18
- Community 19
- Community 20
- Community 21
- Community 22
- Community 23
- Community 24
- Community 25
- Community 26
- Community 27
- Community 28
- Community 29
- Community 30
- Community 31
- Community 32
- Community 33
- Community 34
- Community 35
- Community 36
- Community 37
- Community 38
- Community 39
- Community 40
- Community 41
- Community 42
- Community 43
- Community 44
- Community 45
- Community 46
- Community 47
- Community 48
- Community 49
- Community 50
- Community 51
- Community 52
- Community 53
- Community 54
- Community 55
- Community 56
- Community 57
- Community 58
- Community 59
- Community 60
- Community 61
- Community 62
- Community 63

## God Nodes (most connected - your core abstractions)
1. `handleAuthorizedMessage()` - 83 edges
2. `whatsapp-web.js` - 71 edges
3. `getMessageUserId()` - 61 edges
4. `clearAllOperationSessions()` - 61 edges
5. `getMessageChatId()` - 60 edges
6. `formatCurrency()` - 57 edges
7. `@prisma/client` - 55 edges
8. `env` - 47 edges
9. `handleSaleConversation()` - 42 edges
10. `saveSaleSession()` - 41 edges

## Surprising Connections (you probably didn't know these)
- `queryProduct()` --calls--> `saveLastQuery()`  [EXTRACTED]
  tests/productPhotoCommand.test.ts → src/utils/lastQueryStore.ts
- `startSale()` --calls--> `saveSaleSession()`  [EXTRACTED]
  tests/saleDiscount.test.ts → src/utils/saleSessionStore.ts
- `savePendingSession()` --calls--> `saveAddPhotoSession()`  [EXTRACTED]
  tests/productPhotoCommand.test.ts → src/utils/addPhotoSessionStore.ts
- `saveQuery()` --calls--> `saveLastQuery()`  [EXTRACTED]
  tests/productActionCommand.test.ts → src/utils/lastQueryStore.ts
- `startSale()` --calls--> `saveSaleSession()`  [EXTRACTED]
  tests/mixedPayment.test.ts → src/utils/saleSessionStore.ts

## Import Cycles
- None detected.

## Communities (67 total, 6 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.06
Nodes (104): additionalEntryHelpTimers, buildAdditionalEntryHelpTimerKey(), canReturnFromAdditionalEntry(), clearAdditionalEntryHelpTimer(), finishCurrentItemAndAskForAnother(), getResponsibleName(), handleAdditionalDecisionStep(), handleAdditionalItemStep() (+96 more)

### Community 1 - "Community 1"
Cohesion: 0.06
Nodes (65): countInclusiveCalendarDays(), defaultDependencies, formatConfirmation(), formatConfirmationRequired(), formatDate(), formatEndDateQuestion(), formatReportTypeQuestion(), formatStartDateQuestion() (+57 more)

### Community 2 - "Community 2"
Cohesion: 0.07
Nodes (62): getPendingMentionIds(), COMMISSION_REPORT_STATE_PATH, DAILY_REPORT_STATE_PATH, MONTHLY_REPORT_STATE_PATH, PENDING_REMINDER_STATE_PATH, STOCK_REPORT_STATE_PATH, getDateKey(), isReportTime() (+54 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (37): prisma, PrismaClientOrTransaction, userRepository, AdjustmentInsufficientStockError, AdjustmentProductNotFoundError, AdjustmentSameProductError, AdjustmentStockChangedError, registerAdjustment() (+29 more)

### Community 4 - "Community 4"
Cohesion: 0.07
Nodes (50): whatsappPairing, BrowserProcessClassification, BrowserProcessSnapshot, BrowserProfileRecoveryOptions, BrowserProfileRecoveryResult, classifyBrowserProcesses(), forceStopBrowserProcessTree(), inspectWindowsBrowserProcesses() (+42 more)

### Community 5 - "Community 5"
Cohesion: 0.10
Nodes (47): isAdjustmentCommand(), handleBestSellersCommand(), isBestSellersCommand(), normalizeCommand(), handleEntryCommand(), isEntryCommand(), handleGroupIdCommand(), isGroupIdCommand() (+39 more)

### Community 6 - "Community 6"
Cohesion: 0.07
Nodes (37): getActiveProductForPhoto(), ProductPhotoProductNotFoundError, replaceProductPhoto(), replaceProductPhotoLocked(), ReplaceProductPhotoResult, deleteProductImageFile(), EXTENSION_BY_MIME_TYPE, getSafeAbsolutePath() (+29 more)

### Community 7 - "Community 7"
Cohesion: 0.09
Nodes (25): ControllerDependencies, createController(), labels, Overview, ControlConfig, loadControlConfig(), parseControlConfig(), main() (+17 more)

### Community 8 - "Community 8"
Cohesion: 0.08
Nodes (47): getMonthlyInventoryPdfFileName(), buildCommissionReportForPeriod(), buildCurrentStockReportPdf(), buildDailyMovementHistory(), buildInventoryReportForPeriod(), buildInventoryReportPdf(), buildMonthlyReport(), buildMonthlyReportDelivery() (+39 more)

### Community 9 - "Community 9"
Cohesion: 0.13
Nodes (30): whatsapp-web.js, formatInnerTubeList(), handleInnerTubeCommand(), parseInnerTubeCommand(), handleLowStockCommand(), formatZeroStockProductList(), formatProductList(), formatRetreadedTireList() (+22 more)

### Community 10 - "Community 10"
Cohesion: 0.12
Nodes (41): continueDirectPayment(), handleAdditionalItemStep(), handleCityHallConfirmationStep(), handleDiscountBackStep(), handleDiscountConfirmationStep(), handleDiscountTypeStep(), handleDiscountValueStep(), handleInvoiceNameStep() (+33 more)

### Community 11 - "Community 11"
Cohesion: 0.12
Nodes (37): confirmSingleAdjustment(), confirmTransfer(), formatAdjustmentConfirmation(), formatAdjustmentQuantityQuestion(), formatBossAdjustmentNotification(), formatBossTransferNotification(), formatFinalStockQuestion(), formatReasonQuestion() (+29 more)

### Community 12 - "Community 12"
Cohesion: 0.09
Nodes (33): execute(), main(), pendingSaleInclude, registerPendingSale(), RegisterPendingSaleInput, returnPendingSaleToStock(), validatePendingSaleInput(), getSaleCommissionPercent() (+25 more)

### Community 13 - "Community 13"
Cohesion: 0.18
Nodes (7): whatsappClient, [mode, backupRoot, day, retention = '2'], installer, remover, installer, remover, runner

### Community 14 - "Community 14"
Cohesion: 0.11
Nodes (32): getContactName(), handlePendingSaleConversation(), mapPendingSaleToSaleSession(), parsePositiveInteger(), formatDate(), formatOptionNumber(), formatPendingAssigneeQuestion(), formatPendingItems() (+24 more)

### Community 15 - "Community 15"
Cohesion: 0.15
Nodes (35): addReportPage(), buildMonthlyInventoryPdf(), COLORS, contentWidth(), drawDailyHistory(), drawGroupLabel(), drawInventory(), drawNotice() (+27 more)

### Community 16 - "Community 16"
Cohesion: 0.12
Nodes (23): defaultDependencies, formatProductPhotoCaption(), handleAddPhotoCommand(), handlePhotoCommand(), parseOptionNumber(), PhotoProduct, ProductPhotoCommandDependencies, replyConsultationGuidance() (+15 more)

### Community 17 - "Community 17"
Cohesion: 0.22
Nodes (24): assertSafePath(), containsPath(), DATABASE_SUFFIXES, inspectBackup(), readRestoreState(), RestoreState, validatePhotoTree(), acquireBackupLock() (+16 more)

### Community 18 - "Community 18"
Cohesion: 0.12
Nodes (25): buildLocationStockRestorationPlan(), LocationStockConflict, LocationStockRestoration, LocationStockRestorationPlan, main(), printConflictMovements(), printProblems(), printProducts() (+17 more)

### Community 19 - "Community 19"
Cohesion: 0.11
Nodes (30): buildStockHistory(), StockHistoryEvent, buildLowStockOperationalReport(), buildLowStockReport(), buildTodayReport(), calculatePaymentTotals(), DailyZeroStockSummary, DateRange (+22 more)

### Community 20 - "Community 20"
Cohesion: 0.07
Nodes (30): scripts, backup, build, check, check:runtime, clear:location-stock, control, control:dev (+22 more)

### Community 21 - "Community 21"
Cohesion: 0.19
Nodes (24): handleZeroStockCommand(), replyWithZeroStockProducts(), formatInvalidMeasure(), formatReferenceSuggestions(), formatResolvedReferenceNotice(), handleLegacyPneuCommandNotice(), handlePneuCommand(), handlePneuHelpCommand() (+16 more)

### Community 22 - "Community 22"
Cohesion: 0.21
Nodes (25): findFinalRegisteredStock(), formatBossSaleNotification(), formatCompactPaymentLines(), formatConfirmationPaymentLines(), formatConfirmationSaleItemLines(), formatDiscountLines(), formatDiscountPreview(), formatDiscountSummary() (+17 more)

### Community 23 - "Community 23"
Cohesion: 0.15
Nodes (22): STARTUP_RECOVERY_STATE_PATH, attachLocalPanelLifecycle(), main(), shutdown(), stopDailyReportScheduler(), stopHealthMonitor(), installStructuredLogging(), stopMonthlyReportScheduler() (+14 more)

### Community 24 - "Community 24"
Cohesion: 0.12
Nodes (16): @prisma/client, movementRepository, PrismaClientOrTransaction, pendingSaleReportRepository, ReportPendingSale, PrismaClientOrTransaction, productRepository, InvalidProductLocationError (+8 more)

### Community 25 - "Community 25"
Cohesion: 0.13
Nodes (17): defaultMenuCommandDependencies, MENU_TEXT, MenuCommandDependencies, handleCurrentStockReportCommand(), handleMonthlyInventoryReportCommand(), getMotorcycleTireRim(), handleMotorcycleTireCommand(), MotorcycleTireQuery (+9 more)

### Community 26 - "Community 26"
Cohesion: 0.13
Nodes (18): BOOLEAN_VALUES, DEFAULT_BRANCH_NAME, env, EnvConfig, isValidDailyTime(), isValidPhone(), validateEnvironment(), main() (+10 more)

### Community 27 - "Community 27"
Cohesion: 0.15
Nodes (15): allocateAmountByWeights(), buildKey(), clearSaleSession(), getSaleSession(), hasExpiredSaleSession(), isExpired(), MixedPaymentMethod, ReceiptPaymentMethod (+7 more)

### Community 28 - "Community 28"
Cohesion: 0.23
Nodes (20): formatAdjustmentTypeQuestion(), handleAdjustmentCommand(), defaultDependencies, formatProductActionMenu(), formatSaleQuantityQuestion(), formatZeroStockActionMenu(), handleProductActionConversation(), IndexedCommandHandler (+12 more)

### Community 29 - "Community 29"
Cohesion: 0.22
Nodes (19): confirmProductName(), handleProductNameConversation(), updateLastQueryProductDescription(), buildKey(), getLocationSession(), hasExpiredLocationSession(), isExpired(), locationSessions (+11 more)

### Community 30 - "Community 30"
Cohesion: 0.09
Nodes (22): compilerOptions, declaration, declarationMap, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution (+14 more)

### Community 31 - "Community 31"
Cohesion: 0.12
Nodes (21): author, description, devDependencies, prisma@^6.19.3, tsx@^4.22.4, @types/node@^26.0.1, @types/pdfkit@^0.17.6, @types/qrcode-terminal@^0.12.2 (+13 more)

### Community 32 - "Community 32"
Cohesion: 0.20
Nodes (16): BACKUP_DIRECTORY, DATA_DIRECTORY, PRODUCT_UPLOAD_DIRECTORY, PROJECT_ROOT, main(), BackupManifest, createBackup(), CreateBackupOptions (+8 more)

### Community 33 - "Community 33"
Cohesion: 0.22
Nodes (19): formatLocation(), formatLocationConfirmation(), formatLocationQuestion(), formatRegisteredLocation(), handleLocationConfirmationStep(), handleLocationConversation(), handleLocationStep(), LOCATION_CHOICES (+11 more)

### Community 34 - "Community 34"
Cohesion: 0.17
Nodes (19): execute(), main(), printProducts(), ProductToClear, execute(), main(), MotorcycleCatalogRow, normalizeKey() (+11 more)

### Community 35 - "Community 35"
Cohesion: 0.22
Nodes (18): BATTERY_HELP, formatBatteryBrand(), formatBatteryList(), handleBatteryCommand(), handleZeroStockBatteryCommand(), formatProductChoiceQuestion(), BatteryProductRow, BatterySearchQuery (+10 more)

### Community 36 - "Community 36"
Cohesion: 0.20
Nodes (17): formatBossPriceNotification(), formatPriceConfirmation(), formatRegisteredPriceChange(), getResponsibleName(), handleCashPriceStep(), handleConfirmationStep(), PriceProductNotFoundError, formatMovementNumberMessage() (+9 more)

### Community 37 - "Community 37"
Cohesion: 0.19
Nodes (20): assertCompatibleProductMetadata(), buildCatalogChanges(), CatalogResolution, CatalogUpdate, CsvCatalogRow, execute(), main(), normalizeProductKey() (+12 more)

### Community 38 - "Community 38"
Cohesion: 0.17
Nodes (19): buildPendingPersistenceItems(), canReturnFromAdditionalSale(), forwardSaleReceiptsToBoss(), getSellerName(), handleAdditionalMeasureStep(), handleConfirmationStep(), returnToPreparedSale(), formatPaymentMenu() (+11 more)

### Community 39 - "Community 39"
Cohesion: 0.18
Nodes (17): PRODUCT_SEED_CSV_PATH, buildCsvRow(), CsvRow, InvalidRow, main(), normalizeKey(), parseCsvLine(), parseMoney() (+9 more)

### Community 40 - "Community 40"
Cohesion: 0.18
Nodes (15): handlePaymentStep(), handlePriceTypeStep(), isPendingPriceChangeSelection(), AdditionalSaleItemSelection, isAddItemSelection(), isDiscountSelection(), MAX_SALE_INVOICE_NUMBER_LENGTH, normalizeSaleInvoiceNumber() (+7 more)

### Community 41 - "Community 41"
Cohesion: 0.28
Nodes (8): createPairingHandler(), PairingSnapshot, PairingState, PairingStatus, QRCode, validatePairingSnapshot(), readPairingSnapshot(), startPairingBridge()

### Community 42 - "Community 42"
Cohesion: 0.33
Nodes (15): api(), badge(), byId(), clearPairing(), confirmAction(), date(), logs, notice() (+7 more)

### Community 43 - "Community 43"
Cohesion: 0.14
Nodes (11): { createGunzip }, { createHash }, FILES, fs, path, { pipeline }, { Readable }, repair() (+3 more)

### Community 44 - "Community 44"
Cohesion: 0.18
Nodes (9): Heartbeat, readHeartbeat(), writeHeartbeat(), LogEntry, LogReader, operationalTemplates, plainMessages, preloadMessages (+1 more)

### Community 45 - "Community 45"
Cohesion: 0.29
Nodes (11): buildStockUpdates(), CsvStockRow, execute(), main(), normalizeProductKey(), parseCsvLine(), printMissingRows(), printStockUpdates() (+3 more)

### Community 46 - "Community 46"
Cohesion: 0.18
Nodes (11): dependencies, dotenv@^17.4.2, patch-package@^8.0.1, pdfkit@^0.20.1, @prisma/client@^6.19.3, qrcode-terminal@^0.12.0, whatsapp-web.js@^1.34.7, dotenv (+3 more)

### Community 47 - "Community 47"
Cohesion: 0.18
Nodes (7): ./src/config/appPaths.ts, ./src/config/env.ts, ./src/control/pairing.ts, ./src/services/logger.ts, ./src/services/notificationService.ts, ./src/whatsapp/client.ts, ./src/whatsapp/messageHandler.ts

### Community 48 - "Community 48"
Cohesion: 0.33
Nodes (9): LOG_DIRECTORY, dateKey(), getLogFilePath(), LogLevel, originalConsole, removeExpiredLogs(), sanitize(), stringifyArgument() (+1 more)

### Community 49 - "Community 49"
Cohesion: 0.33
Nodes (6): assertRuntimeEnvironment(), AppliedMigrationRow, assertDatabaseMigrationsApplied(), findPendingMigrations(), MIGRATIONS_DIRECTORY, runStartupChecks()

### Community 50 - "Community 50"
Cohesion: 0.22
Nodes (5): clientSource, { exposeFunctionIfAbsent }, indexSource, require, whatsappPatch

### Community 51 - "Community 51"
Cohesion: 0.25
Nodes (6): assert, fs, os, path, runTests(), { spawnSync }

### Community 52 - "Community 52"
Cohesion: 0.39
Nodes (5): clearProcessedMessages(), getMessageId(), markMessageForProcessing(), processedMessages, pruneExpiredMessages()

### Community 53 - "Community 53"
Cohesion: 0.29
Nodes (4): construction, end, source, start

### Community 54 - "Community 54"
Cohesion: 0.48
Nodes (6): DuplicateProductNameError, InvalidProductNameError, ProductNameChangedError, ProductNameNotFoundError, renameProduct(), RenameProductInput

### Community 55 - "Community 55"
Cohesion: 0.33
Nodes (6): overrides, basic-ftp, brace-expansion, deepmerge-ts, ip-address, js-yaml

### Community 57 - "Community 57"
Cohesion: 0.40
Nodes (6): handleAdditionalQuantityStep(), handleSaleCommand(), prepareAdditionalSaleItem(), formatPriceTypeQuestion(), calculateSaleTotal(), getCurrentProductStock()

### Community 59 - "Community 59"
Cohesion: 0.70
Nodes (4): editDistance(), formatSimilarProductSearchHelp(), normalize(), resembles()

### Community 60 - "Community 60"
Cohesion: 0.50
Nodes (4): apply(), cli, root, run()

### Community 61 - "Community 61"
Cohesion: 0.50
Nodes (3): fs, path, root

### Community 63 - "Community 63"
Cohesion: 0.67
Nodes (3): { Client, Message }, disabled(), offlineError()

## Knowledge Gaps
- **8 isolated node(s):** `./src/database/prisma.ts`, `./src/database/syncProductStocks.ts`, `./src/whatsapp/client.ts`, `./src/control/pairing.ts`, `./src/services/logger.ts` (+3 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 385 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `whatsapp-web.js` connect `Community 9` to `Community 0`, `Community 1`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 6`, `Community 10`, `Community 11`, `Community 13`, `Community 14`, `Community 16`, `Community 21`, `Community 24`, `Community 25`, `Community 26`, `Community 27`, `Community 28`, `Community 29`, `Community 31`, `Community 33`, `Community 35`, `Community 36`, `Community 46`, `Community 50`, `Community 52`, `Community 63`?**
  _High betweenness centrality (0.090) - this node is a cross-community bridge._
- **What connects `./src/database/prisma.ts`, `./src/database/syncProductStocks.ts`, `./src/whatsapp/client.ts` to the rest of the system?**
  _8 weakly-connected nodes found - possible missing edges._
- **Should `Community 0` be split into smaller, more focused modules?**
  _Cohesion score 0.05953317597692106 - nodes in this community are weakly interconnected._
- **Why does `@prisma/client` connect `Community 24` to `Community 0`, `Community 3`, `Community 6`, `Community 8`, `Community 9`, `Community 11`, `Community 12`, `Community 13`, `Community 15`, `Community 16`, `Community 17`, `Community 18`, `Community 19`, `Community 21`, `Community 25`, `Community 27`, `Community 28`, `Community 29`, `Community 31`, `Community 34`, `Community 35`, `Community 36`, `Community 37`, `Community 39`, `Community 46`, `Community 54`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Should `Community 1` be split into smaller, more focused modules?**
  _Cohesion score 0.05877742946708464 - nodes in this community are weakly interconnected._
- **Why does `env` connect `Community 26` to `Community 0`, `Community 2`, `Community 3`, `Community 4`, `Community 5`, `Community 8`, `Community 9`, `Community 10`, `Community 12`, `Community 13`, `Community 17`, `Community 18`, `Community 21`, `Community 22`, `Community 23`, `Community 25`, `Community 27`, `Community 28`, `Community 32`, `Community 33`, `Community 34`, `Community 35`, `Community 37`, `Community 45`, `Community 48`, `Community 49`?**
  _High betweenness centrality (0.046) - this node is a cross-community bridge._
- **Should `Community 2` be split into smaller, more focused modules?**
  _Cohesion score 0.06648575305291723 - nodes in this community are weakly interconnected._