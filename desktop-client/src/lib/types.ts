// Sunucu API sözleşmesi (HotelPms.Server DTO'ları ile birebir). Para alanları ondalık metin: "1250.00".
export type Money = string;
export type DateStr = string;

export interface Paged<T> { items: T[]; total: number; page: number; pageSize: number }
export interface Me { id: string; username: string; fullName: string; roles: string[]; permissions: string[]; mustChangePassword: boolean; deviceId?: string }
export interface SystemInfo { product: string; serverName: string; hostname: string; version: string; minClientVersion: string; setupRequired: boolean; hotelName?: string; caFingerprintSha256?: string; httpsPort: number }

export interface Property {
  id: string; name: string; legalName?: string; taxOffice?: string; taxNumber?: string; address?: string; city?: string; country: string; phone?: string; email?: string;
  timeZone: string; currency: string; businessDate: DateStr; checkInTime: string; checkOutTime: string; version: number;
}
export interface Setting { key: string; value: unknown }
export interface LicenseStatus {
  state: 'trial' | 'trial_expired' | 'licensed' | 'expired' | 'invalid'; message: string; restricted: boolean; licenseId?: string; customer?: string; hotel?: string;
  taxNumber?: string; maxRooms?: number; modules: string[]; expiresAt?: DateStr; supportUntil?: DateStr; trialEndsAt?: DateStr; daysLeft?: number; activeRooms: number;
}

export interface RoomType { id: string; code: string; name: string; description?: string; maxAdults: number; maxChildren: number; defaultRate: Money; sortOrder: number; isActive: boolean; roomCount: number; version: number }
export interface Room { id: string; roomTypeId: string; roomTypeCode: string; number: string; floor?: string; description?: string; features?: string; hkStatus: string; isDnd: boolean; hkNote?: string; sortOrder: number; isActive: boolean; version: number }
export interface RoomStatus {
  id: string; number: string; floor?: string; roomTypeId: string; roomTypeCode: string; hkStatus: string; isDnd: boolean; hkNote?: string; hkUpdatedAt?: string;
  foStatus: 'occupied' | 'vacant'; blockKind?: string; blockReason?: string; inHouseReservationId?: string; inHouseGuest?: string; inHouseDeparture?: DateStr; isVip: boolean;
  arrivalReservationId?: string; arrivalGuest?: string; departureToday: boolean; openTasks: number; openTickets: number;
  inHouseCheckedInAt?: string; inHouseAccount?: string; inHouseNote?: string; inHousePax?: number; inHouseBalance?: Money; inHouseCurrency?: string;
  arrivalEta?: string; arrivalAccount?: string; arrivalNote?: string; arrivalDeparture?: DateStr;
}
export interface RoomBlock { id: string; roomId: string; roomNumber: string; kind: string; dateFrom: DateStr; dateTo: DateStr; reason: string; ticketId?: string; isActive: boolean; createdAt: string; createdBy?: string }

export interface GuestListItem { id: string; firstName: string; lastName: string; nationality?: string; identityNumber?: string; phone?: string; email?: string; isVip: boolean; isBlacklisted: boolean; stayCount: number; lastStay?: DateStr }
export interface Guest {
  id: string; firstName: string; lastName: string; gender?: string; birthDate?: DateStr; birthPlace?: string; fatherName?: string; motherName?: string; nationality?: string;
  identityType?: string; identityNumber?: string; identityCountry?: string; identityExpiry?: DateStr; phone?: string; email?: string; address?: string; city?: string; country?: string;
  taxOffice?: string; taxNumber?: string; companyId?: string; companyName?: string; notes?: string; preferences?: string; isVip: boolean; vipLevel?: string; isBlacklisted: boolean;
  blacklistReason?: string; kvkkConsent: boolean; kvkkConsentAt?: string; marketingConsent: boolean; createdAt: string; migrationSource?: string; version: number; anonymizedAt?: string;
  title?: string; maritalStatus?: string; language?: string; phone2?: string; identitySerial?: string; identityIssuePlace?: string; identityIssueDate?: DateStr;
  district?: string; postalCode?: string; vehiclePlate?: string; alertNote?: string; roomDiscountPct: Money; extraDiscountPct: Money;
}
export interface GuestStay { id: string; reservationNumber: string; status: string; arrival: DateStr; departure: DateStr; roomNumber?: string; roomTypeCode: string; nightlyRate: Money; currency: string }
export interface GuestFolio { id: string; folioNumber: string; status: string; balance: Money; totalCharges: Money; totalPayments: Money }
export interface GuestProfile { guest: Guest; stays: GuestStay[]; folios: GuestFolio[]; totalRevenue: Money }

export interface Account {
  id: string; code?: string; name: string; taxOffice?: string; taxNumber?: string; address?: string; city?: string; country?: string; phone?: string; email?: string;
  contactName?: string; creditLimit?: Money; commissionRate?: Money; isCityLedger: boolean; notes?: string; isActive: boolean; balance: Money; version: number;
}
export interface RatePlan { id: string; code: string; name: string; mealPlan: string; description?: string; isActive: boolean; version: number; currency?: string }
export interface RatePrice { id: string; ratePlanId: string; roomTypeId: string; roomTypeCode: string; dateFrom: DateStr; dateTo: DateStr; price: Money; minStay?: number }

export interface Reservation {
  id: string; reservationNumber: string; status: string; guestId: string; guestName: string; guestIsVip: boolean; guestIsBlacklisted: boolean;
  companyId?: string; companyName?: string; agencyId?: string; agencyName?: string; groupId?: string; groupName?: string; roomTypeId: string; roomTypeCode: string;
  roomId?: string; roomNumber?: string; arrival: DateStr; departure: DateStr; nights: number; adults: number; children: number; ratePlanId?: string; ratePlanCode?: string;
  nightlyRate: Money; totalRate: Money; currency: string; mealPlan: string; source: string; market?: string; segment?: string; isWalkIn: boolean; eta?: string; etd?: string;
  roomChargeWindow: number; notes?: string; specialRequests?: string; depositRequired: Money; optionUntil?: DateStr; checkedInAt?: string; checkedOutAt?: string;
  cancelledAt?: string; cancelReason?: string; createdAt: string; createdBy?: string; balance: Money; version: number; rateCurrency?: string; fxNightlyRate?: Money;
  channel?: string; channelRef?: string; guestAlertNote?: string;
}
export interface ReservationListItem {
  id: string; reservationNumber: string; status: string; guestName: string; guestIsVip: boolean; companyName?: string; agencyName?: string; roomTypeCode: string;
  roomNumber?: string; arrival: DateStr; departure: DateStr; adults: number; children: number; nightlyRate: Money; currency: string; source: string; balance: Money;
  channel?: string; channelRef?: string;
}
export interface AvailabilityDay { date: DateStr; roomTypeId: string; roomTypeCode: string; total: number; blocked: number; sold: number; held: number; available: number }
export interface RatePreview { nights: { date: DateStr; rate: Money }[]; total: Money; average: Money; source: string; currency?: string; discountPct: Money }
export interface RackRoom { id: string; number: string; floor?: string; roomTypeId: string; roomTypeCode: string; hkStatus: string; isDnd: boolean; sortOrder: number }
export interface RackBar { reservationId: string; reservationNumber: string; roomId?: string; roomTypeId: string; status: string; guestName: string; isVip: boolean; arrival: DateStr; departure: DateStr; adults: number; children: number; companyName?: string; agencyName?: string; balance: Money }
export interface RackBlock { id: string; roomId: string; kind: string; dateFrom: DateStr; dateTo: DateStr; reason: string }
export interface Rack { from: DateStr; to: DateStr; businessDate: DateStr; rooms: RackRoom[]; bars: RackBar[]; blocks: RackBlock[]; unassigned: RackBar[] }
export interface Sharer { id: string; name: string; isPrimary: boolean; nationality?: string; hasIdentity: boolean }
export interface AuditRow { at: string; username?: string; action: string; reason?: string }
export interface Wakeup { id: string; reservationId: string; roomNumber?: string; guestName: string; callAt: string; status: string; notes?: string }

export interface Folio {
  id: string; folioNumber: string; reservationId?: string; reservationNumber?: string; windowNo: number; payerKind: string; guestId?: string; companyId?: string; agencyId?: string;
  name: string; currency: string; status: string; balance: Money; totalCharges: Money; totalCredits: Money; invoiceNumber?: string; invoiceDate?: DateStr; createdAt: string; version: number;
}
export interface FolioLine {
  id: string; folioId: string; lineType: string; transactionCode?: string; paymentMethod?: string; description: string; quantity: string; unitPrice?: Money; amount: Money;
  currency: string; businessDate: DateStr; postedAt: string; username?: string; shiftNo?: number; reference?: string; reason?: string; relatedLineId?: string; roomNumber?: string;
  isVoided: boolean; transferredOut: Money; tenderedCurrency?: string; tenderedAmount?: Money; exchangeRate?: string;
}
export interface FolioDetail { folio: Folio; lines: FolioLine[] }
export interface TransactionCode { id: string; code: string; name: string; category: string; defaultPrice?: Money; vatRate: Money; isSystem: boolean; isActive: boolean }
export interface PaymentMethod { id: string; code: string; name: string; kind: string; requiresReference: boolean; isSystem: boolean; isActive: boolean }
export interface Shift { id: string; shiftNo: number; userId: string; username: string; businessDate: DateStr; openedAt: string; openingFloat: Money; closedAt?: string; countedCash?: Money; expectedCash?: Money; difference?: Money; closeNote?: string; status: string }
export interface ShiftCash { currency: string; expected: Money; counted?: Money; difference?: Money }
export interface ShiftReport { shift: Shift; totals: { paymentMethod: string; kind: string; currency: string; collected: Money; refunded: Money; net: Money; count: number }[]; expectedCash: Money; cash: ShiftCash[] }
export interface ExchangeRate { currency: string; rateDate: DateStr; rate: string; source: 'manual' | 'tcmb'; username?: string; createdAt: string }
export interface ExchangeRatesView { baseCurrency: string; businessDate: DateStr; currencies: string[]; rates: ExchangeRate[]; tcmbAvailable: boolean }
export interface TcmbImportResult { rateDate: DateStr; bulletinDate: string; rateType: string; rates: ExchangeRate[]; missing: string[] }

export interface HkTask { id: string; roomId: string; roomNumber: string; floor?: string; taskType: string; status: string; businessDate: DateStr; assignedUserId?: string; assignedTo?: string; notes?: string; createdAt: string; completedAt?: string; version: number }
export interface Staff { id: string; username: string; fullName: string }
export interface Ticket { id: string; ticketNo: number; roomId?: string; roomNumber?: string; location?: string; issue: string; description?: string; priority: string; status: string; assignedUserId?: string; assignedTo?: string; openedAt: string; openedBy?: string; resolvedAt?: string; notes?: string; version: number }

export interface AuditIssue { code: string; severity: string; message: string; reservationId?: string; reference?: string }
export interface NightAuditPreview { businessDate: DateStr; nextBusinessDate: DateStr; alreadyClosed: boolean; blockers: AuditIssue[]; warnings: AuditIssue[]; roomChargesToPost: number; roomChargeTotal: Money; inHouse: number; canRun: boolean }
export interface NightAuditResult { closedDate: DateStr; newBusinessDate: DateStr; roomChargesPosted: number; roomChargeTotal: Money; noShows: number; warnings: AuditIssue[]; optionsCancelled: number; accommodationTaxTotal: Money }

export interface Dashboard {
  businessDate: DateStr; hotelName: string; currency: string; roomsTotal: number; occupied: number; vacantClean: number; vacantDirty: number; outOfOrder: number;
  arrivalsExpected: number; arrivalsCheckedIn: number; departuresExpected: number; departuresCheckedOut: number; guestsInHouse: number; occupancyPct: Money;
  roomRevenueToday: Money; otherRevenueToday: Money; paymentsToday: Money; openBalance: Money; openTickets: number; openHkTasks: number; kbsPending: number;
  pendingWakeups: number; openTraces?: number; lastNightAudit?: DateStr; forecast: { date: DateStr; sold: number; available: number; occupancyPct: Money }[];
}
export interface ReportColumn { key: string; header: string; type: string }
export interface ReportParam { key: string; label: string; type: string; required: boolean }
export interface ReportInfo { name: string; title: string; category: string; params: ReportParam[]; columns: ReportColumn[] }
export interface ReportResult { name: string; title: string; columns: ReportColumn[]; rows: Record<string, unknown>[]; totals: Record<string, unknown>; generatedAt: string; businessDate: DateStr }
export interface KbsReport { id: string; reservationId: string; reservationNumber: string; roomNumber?: string; guestId: string; guestName: string; event: string; status: string; manualReference?: string; manualReason?: string; createdAt: string; updatedAt: string }

export interface User { id: string; username: string; fullName: string; email?: string; isActive: boolean; mustChangePassword: boolean; lastLoginAt?: string; lockedUntil?: string; roles: string[]; version: number }
export interface Role { code: string; name: string; isSystem: boolean; permissions: string[] }
export interface Permission { code: string; module: string; description: string }
export interface Device { id: string; name: string; kind: string; hostname?: string; lastIp?: string; clientVersion?: string; lastUser?: string; status: string; registeredAt: string; lastSeenAt: string }
export interface Session { id: string; username: string; deviceName?: string; ip?: string; createdAt: string; lastSeenAt: string; expiresAt: string }
export interface Backup { id: string; kind: string; fileName: string; directory: string; sizeBytes?: number; sha256?: string; schemaVersion: string; appVersion: string; status: string; error?: string; secondaryStatus?: string; startedAt: string; finishedAt?: string; username?: string }
export interface BackupPolicy { schedule: string; time: string; weeklyDay: number; monthlyDay: number; primaryDirectory: string; secondaryDirectory?: string; keepScheduled: number; keepManual: number; keepSystem: number }
export interface Printer { name: string; isDefault: boolean }
export interface AuditLog { id: number; at: string; username?: string; hostname?: string; ip?: string; action: string; entityType?: string; entityId?: string; oldValue?: string; newValue?: string; reason?: string }
export interface Document { id: string; entityType: string; entityId: string; category: string; originalName: string; mimeType: string; sizeBytes: number; sha256: string; uploadedAt: string; uploadedBy?: string }

// Veri aktarımı
export interface TargetField { key: string; label: string; type: string; required: boolean; synonyms: string[]; note?: string }
export interface FieldMapping { source: string | null; target: string; transform: string; format?: string | null; constant?: string | null }
export interface MappingSuggestion { target: string; source?: string; confidence: number }
export interface SourceInspection { tables: { name: string; rowCount?: number }[]; selectedTable?: string; columns: string[]; preview: (string | null)[][]; detectedEncoding?: string; detectedSeparator?: string; warnings: string[]; mojibakeCells: number }
export interface ImportJob {
  id: string; jobNo: number; entity: string; status: string; sourceType: string; sourceLabel: string; sourceMeta: Record<string, unknown>; options: Record<string, unknown>;
  mapping?: FieldMapping[]; duplicatePolicy: string; totalRows: number; validRows: number; importedRows: number; updatedRows: number; skippedRows: number; failedRows: number;
  reviewRows: number; duplicateRows: number; backupId?: string; createdAt: string; createdBy?: string; startedAt?: string; finishedAt?: string; rolledBackAt?: string; error?: string;
}
export interface InspectResponse { job: ImportJob; inspection: SourceInspection; suggestions: MappingSuggestion[]; targets: TargetField[] }
export interface StagingRow { rowNo: number; raw: Record<string, string | null>; mapped?: Record<string, string | null>; status: string; duplicateOf?: string; duplicateScore?: number; duplicateReason?: string; reviewDecision?: string; targetId?: string; errors?: string }
export interface ImportError { id: number; rowNo?: number; field?: string; value?: string; reason: string; severity: string }
export interface SourceCapability { type: string; label: string; available: boolean; note?: string }
export interface MappingProfile { id: string; name: string; sourceType: string; entity: string; mapping: FieldMapping[]; options: Record<string, unknown>; createdAt: string }

// İstemci (Rust)
export interface ServerEntry { id: string; name: string; host: string; port: number; caPem: string; caFingerprint: string; addedAt: string }
export interface ClientInfo { deviceId: string; hostname: string; version: string; activeServer?: ServerEntry }
export interface ProbeResult { info: SystemInfo; caPem: string; caFingerprint: string; fingerprintMatchesServer: boolean }
export interface TestResult { ok: boolean; message: string; latencyMs: number; serverVersion?: string; compatible: boolean; databaseReady: boolean; hotelName?: string; setupRequired: boolean }
export interface DiscoveredServer { product: string; name: string; hostname: string; httpsPort: number; version: string; addresses: string[]; caFingerprint?: string; replyFrom: string }

// ---- Stok ve satın alma
export interface Warehouse { id: string; code: string; name: string; isActive: boolean; version: number }
export interface StockItem { id: string; code: string; name: string; unit: string; category?: string; barcode?: string; minQty?: string; vatRate: string; isActive: boolean; totalQty: string; version: number }
export interface Supplier { id: string; name: string; taxOffice?: string; taxNumber?: string; contactName?: string; phone?: string; email?: string; address?: string; notes?: string; isActive: boolean; version: number }
export interface StockBalance { warehouseId: string; warehouseCode: string; warehouseName: string; itemId: string; itemCode: string; itemName: string; unit: string; category?: string; quantity: string; avgCost: string; value: Money; minQty?: string }
export interface StockMovement { id: string; documentId: string; docNo: string; kind: string; warehouseCode: string; quantity: string; unitCost: string; isReversal: boolean; businessDate: DateStr; createdAt: string; username?: string; party?: string }
export interface StockDocument { id: string; docNo: string; kind: 'receipt' | 'issue' | 'transfer' | 'count' | 'pos'; warehouseId: string; warehouseName: string; targetWarehouseName?: string; supplierId?: string; supplierName?: string; purchaseOrderNo?: string; invoiceNo?: string; invoiceDate?: DateStr; department?: string; reference?: string; notes?: string; businessDate: DateStr; username?: string; createdAt: string; isCancelled: boolean; cancelReason?: string; totalValue: Money; lineCount: number }
export interface StockDocumentLine { itemId: string; itemCode: string; itemName: string; unit: string; warehouseCode: string; quantity: string; unitCost: string; amount: Money; isReversal: boolean }
export interface PurchaseOrder { id: string; orderNo: string; supplierId: string; supplierName: string; warehouseId: string; warehouseName: string; status: 'draft' | 'ordered' | 'partially_received' | 'received' | 'cancelled'; orderDate: DateStr; expectedDate?: DateStr; notes?: string; cancelReason?: string; total: Money; username?: string; createdAt: string; version: number }
export interface PurchaseOrderLine { id: string; lineNo: number; itemId: string; itemCode: string; itemName: string; unit: string; quantity: string; unitCost: string; vatRate: string; receivedQty: string; amount: Money }

// ---- Restoran / POS
export interface Outlet { id: string; code: string; name: string; transactionCodeId: string; transactionCode: string; warehouseId?: string; warehouseName?: string; sortOrder: number; isActive: boolean; openChecks: number; version: number }
export interface PosProduct { id: string; code: string; name: string; category: string; price: Money; vatRate: string; sortOrder: number; isActive: boolean; outletIds: string[]; recipeItems: number; printerId?: string; version: number }
export interface PosPrinter { id: string; name: string; host: string; port: number; codePage: 'PC857' | 'ASCII'; lineWidth: number; isActive: boolean; products: number; version: number }
export interface PosSendResult { sent: string[]; failed: { printer: string; error: string }[]; lines: number; detail: PosCheckDetail }
export interface RecipeLine { stockItemId: string; itemCode: string; itemName: string; unit: string; quantity: string }
export interface PosCheck { id: string; checkNo: number; outletId: string; outletName: string; tableLabel?: string; covers: number; status: 'open' | 'closed' | 'cancelled'; businessDate: DateStr; openedBy?: string; openedAt: string; note?: string; subtotal: Money; discountAmount: Money; discountReason?: string; total: Money; paid: Money; settlement?: 'room' | 'payment' | 'complimentary'; reservationId?: string; roomNumber?: string; guestName?: string; closedBy?: string; closedAt?: string; closedBusinessDate?: DateStr; cancelReason?: string; itemCount: number; version: number }
export interface PosCheckLine { id: string; productId: string; name: string; quantity: string; unitPrice: Money; amount: Money; vatRate: string; note?: string; addedBy?: string; addedAt: string; isVoid: boolean; voidReason?: string; voidedBy?: string; printable: boolean; sentAt?: string }
export interface PosCheckPayment { id: string; paymentMethod: string; amount: Money; tenderedCurrency?: string; tenderedAmount?: Money; exchangeRate?: string; reference?: string; isReversal: boolean; username?: string; createdAt: string }
export interface PosCheckDetail { check: PosCheck; lines: PosCheckLine[]; payments: PosCheckPayment[] }
export interface InHouseRoom { reservationId: string; roomNumber: string; guestName: string; departure: DateStr; isBlacklisted: boolean }

// ---- Acente kontenjanı
export interface Allotment { id: string; agencyId: string; agencyName: string; roomTypeId: string; roomTypeCode: string; dateFrom: DateStr; dateTo: DateStr; rooms: number; releaseDays: number; notes?: string; isActive: boolean; usedRoomNights: number; totalRoomNights: number; createdBy?: string; createdAt: string; version: number }
export interface AllotmentDay { date: DateStr; rooms: number; used: number; remaining: number; releaseDate: DateStr; released: boolean }
