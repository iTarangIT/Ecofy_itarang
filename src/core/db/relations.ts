import { relations } from "drizzle-orm/relations";
import { tenants, userSessions, users, importBatches, importRows, calcReleases, calcAppliances, calcSystems, orgs, listItems, epcPartners, financiers, columnMappings, caseAssignments, cases, caseReturns, appointments, assessments, eligibilityChecks, quoteRequests, financingDecisions, files, installations, downPayments, disbursements, assets, emiStatusUpdates, assetEvents, withdrawals, documents, notifications, smsMessages, outboxEvents, funnelDaily, eligibilityValues, financingValues, tenantDomains, auditLog, activities, caseStageHistory, seatLedger, installationEvents, fileAcceptances, offers, otpChallenges, customers, quotes, holidays, seatLimits, workingHours, settings, idempotencyKeys, trustedDevices } from "./schema";

export const userSessionsRelations = relations(userSessions, ({one}) => ({
	tenant: one(tenants, {
		fields: [userSessions.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [userSessions.userId],
		references: [users.id]
	}),
}));

export const tenantsRelations = relations(tenants, ({many}) => ({
	userSessions: many(userSessions),
	importRows: many(importRows),
	calcAppliances: many(calcAppliances),
	calcSystems: many(calcSystems),
	orgs: many(orgs),
	users: many(users),
	listItems: many(listItems),
	epcPartners: many(epcPartners),
	financiers: many(financiers),
	columnMappings: many(columnMappings),
	importBatches: many(importBatches),
	caseAssignments: many(caseAssignments),
	caseReturns: many(caseReturns),
	appointments: many(appointments),
	calcReleases: many(calcReleases),
	assessments: many(assessments),
	eligibilityChecks: many(eligibilityChecks),
	quoteRequests: many(quoteRequests),
	financingDecisions: many(financingDecisions),
	installations: many(installations),
	downPayments: many(downPayments),
	disbursements: many(disbursements),
	assets: many(assets),
	emiStatusUpdates: many(emiStatusUpdates),
	assetEvents: many(assetEvents),
	withdrawals: many(withdrawals),
	documents: many(documents),
	notifications: many(notifications),
	smsMessages: many(smsMessages),
	outboxEvents: many(outboxEvents),
	funnelDailies: many(funnelDaily),
	eligibilityValues: many(eligibilityValues),
	financingValues: many(financingValues),
	tenantDomains: many(tenantDomains),
	auditLogs: many(auditLog),
	activities: many(activities),
	caseStageHistories: many(caseStageHistory),
	seatLedgers: many(seatLedger),
	installationEvents: many(installationEvents),
	fileAcceptances: many(fileAcceptances),
	cases: many(cases),
	customers: many(customers),
	files: many(files),
	quotes: many(quotes),
	offers: many(offers),
	otpChallenges: many(otpChallenges),
	holidays: many(holidays),
	seatLimits: many(seatLimits),
	workingHours: many(workingHours),
	settings: many(settings),
	idempotencyKeys: many(idempotencyKeys),
	trustedDevices: many(trustedDevices),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	userSessions: many(userSessions),
	org: one(orgs, {
		fields: [users.orgId],
		references: [orgs.id]
	}),
	tenant: one(tenants, {
		fields: [users.tenantId],
		references: [tenants.id]
	}),
	columnMappings: many(columnMappings),
	importBatches: many(importBatches),
	caseAssignments_assignedBy: many(caseAssignments, {
		relationName: "caseAssignments_assignedBy_users_id"
	}),
	caseAssignments_userId: many(caseAssignments, {
		relationName: "caseAssignments_userId_users_id"
	}),
	caseReturns_returnedBy: many(caseReturns, {
		relationName: "caseReturns_returnedBy_users_id"
	}),
	caseReturns_returnedTo: many(caseReturns, {
		relationName: "caseReturns_returnedTo_users_id"
	}),
	appointments: many(appointments),
	calcReleases_createdBy: many(calcReleases, {
		relationName: "calcReleases_createdBy_users_id"
	}),
	calcReleases_decidedBy: many(calcReleases, {
		relationName: "calcReleases_decidedBy_users_id"
	}),
	assessments_confirmedBy: many(assessments, {
		relationName: "assessments_confirmedBy_users_id"
	}),
	assessments_createdBy: many(assessments, {
		relationName: "assessments_createdBy_users_id"
	}),
	eligibilityChecks_decidedBy: many(eligibilityChecks, {
		relationName: "eligibilityChecks_decidedBy_users_id"
	}),
	eligibilityChecks_requestedBy: many(eligibilityChecks, {
		relationName: "eligibilityChecks_requestedBy_users_id"
	}),
	quoteRequests: many(quoteRequests),
	financingDecisions_recordedBy: many(financingDecisions, {
		relationName: "financingDecisions_recordedBy_users_id"
	}),
	financingDecisions_routedBy: many(financingDecisions, {
		relationName: "financingDecisions_routedBy_users_id"
	}),
	installations: many(installations),
	downPayments: many(downPayments),
	disbursements: many(disbursements),
	emiStatusUpdates: many(emiStatusUpdates),
	assetEvents: many(assetEvents),
	withdrawals_confirmedBy: many(withdrawals, {
		relationName: "withdrawals_confirmedBy_users_id"
	}),
	withdrawals_requestedBy: many(withdrawals, {
		relationName: "withdrawals_requestedBy_users_id"
	}),
	documents: many(documents),
	notifications: many(notifications),
	eligibilityValues: many(eligibilityValues),
	financingValues: many(financingValues),
	auditLogs: many(auditLog),
	activities: many(activities),
	caseStageHistories: many(caseStageHistory),
	seatLedgers_actorId: many(seatLedger, {
		relationName: "seatLedger_actorId_users_id"
	}),
	seatLedgers_userId: many(seatLedger, {
		relationName: "seatLedger_userId_users_id"
	}),
	installationEvents: many(installationEvents),
	cases_assignedUserId: many(cases, {
		relationName: "cases_assignedUserId_users_id"
	}),
	cases_createdBy: many(cases, {
		relationName: "cases_createdBy_users_id"
	}),
	cases_qualifiedBy: many(cases, {
		relationName: "cases_qualifiedBy_users_id"
	}),
	quotes: many(quotes),
	offers: many(offers),
	otpChallenges: many(otpChallenges),
	settings: many(settings),
	idempotencyKeys: many(idempotencyKeys),
	trustedDevices: many(trustedDevices),
}));

export const importRowsRelations = relations(importRows, ({one}) => ({
	importBatch: one(importBatches, {
		fields: [importRows.batchId],
		references: [importBatches.id]
	}),
	tenant: one(tenants, {
		fields: [importRows.tenantId],
		references: [tenants.id]
	}),
}));

export const importBatchesRelations = relations(importBatches, ({one, many}) => ({
	importRows: many(importRows),
	columnMapping: one(columnMappings, {
		fields: [importBatches.mappingId],
		references: [columnMappings.id]
	}),
	tenant: one(tenants, {
		fields: [importBatches.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [importBatches.uploadedBy],
		references: [users.id]
	}),
	cases: many(cases),
}));

export const calcAppliancesRelations = relations(calcAppliances, ({one}) => ({
	calcRelease: one(calcReleases, {
		fields: [calcAppliances.releaseId],
		references: [calcReleases.id]
	}),
	tenant: one(tenants, {
		fields: [calcAppliances.tenantId],
		references: [tenants.id]
	}),
}));

export const calcReleasesRelations = relations(calcReleases, ({one, many}) => ({
	calcAppliances: many(calcAppliances),
	calcSystems: many(calcSystems),
	user_createdBy: one(users, {
		fields: [calcReleases.createdBy],
		references: [users.id],
		relationName: "calcReleases_createdBy_users_id"
	}),
	user_decidedBy: one(users, {
		fields: [calcReleases.decidedBy],
		references: [users.id],
		relationName: "calcReleases_decidedBy_users_id"
	}),
	tenant: one(tenants, {
		fields: [calcReleases.tenantId],
		references: [tenants.id]
	}),
	assessments: many(assessments),
}));

export const calcSystemsRelations = relations(calcSystems, ({one}) => ({
	calcRelease: one(calcReleases, {
		fields: [calcSystems.releaseId],
		references: [calcReleases.id]
	}),
	tenant: one(tenants, {
		fields: [calcSystems.tenantId],
		references: [tenants.id]
	}),
}));

export const orgsRelations = relations(orgs, ({one, many}) => ({
	tenant: one(tenants, {
		fields: [orgs.tenantId],
		references: [tenants.id]
	}),
	users: many(users),
	cases: many(cases),
}));

export const listItemsRelations = relations(listItems, ({one}) => ({
	tenant: one(tenants, {
		fields: [listItems.tenantId],
		references: [tenants.id]
	}),
}));

export const epcPartnersRelations = relations(epcPartners, ({one, many}) => ({
	tenant: one(tenants, {
		fields: [epcPartners.tenantId],
		references: [tenants.id]
	}),
	appointments: many(appointments),
	quoteRequests: many(quoteRequests),
	installations: many(installations),
	quotes: many(quotes),
}));

export const financiersRelations = relations(financiers, ({one, many}) => ({
	tenant: one(tenants, {
		fields: [financiers.tenantId],
		references: [tenants.id]
	}),
	eligibilityChecks: many(eligibilityChecks),
	financingDecisions: many(financingDecisions),
	cases: many(cases),
}));

export const columnMappingsRelations = relations(columnMappings, ({one, many}) => ({
	user: one(users, {
		fields: [columnMappings.createdBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [columnMappings.tenantId],
		references: [tenants.id]
	}),
	importBatches: many(importBatches),
}));

export const caseAssignmentsRelations = relations(caseAssignments, ({one}) => ({
	user_assignedBy: one(users, {
		fields: [caseAssignments.assignedBy],
		references: [users.id],
		relationName: "caseAssignments_assignedBy_users_id"
	}),
	case: one(cases, {
		fields: [caseAssignments.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [caseAssignments.tenantId],
		references: [tenants.id]
	}),
	user_userId: one(users, {
		fields: [caseAssignments.userId],
		references: [users.id],
		relationName: "caseAssignments_userId_users_id"
	}),
}));

export const casesRelations = relations(cases, ({one, many}) => ({
	caseAssignments: many(caseAssignments),
	caseReturns: many(caseReturns),
	appointments: many(appointments),
	assessments: many(assessments),
	eligibilityChecks: many(eligibilityChecks),
	quoteRequests: many(quoteRequests),
	financingDecisions: many(financingDecisions),
	installations: many(installations),
	downPayments: many(downPayments),
	disbursements: many(disbursements),
	assets: many(assets),
	withdrawals: many(withdrawals),
	documents: many(documents),
	notifications: many(notifications),
	smsMessages: many(smsMessages),
	activities: many(activities),
	caseStageHistories: many(caseStageHistory),
	user_assignedUserId: one(users, {
		fields: [cases.assignedUserId],
		references: [users.id],
		relationName: "cases_assignedUserId_users_id"
	}),
	user_createdBy: one(users, {
		fields: [cases.createdBy],
		references: [users.id],
		relationName: "cases_createdBy_users_id"
	}),
	customer: one(customers, {
		fields: [cases.customerId],
		references: [customers.id]
	}),
	financier: one(financiers, {
		fields: [cases.financierId],
		references: [financiers.id]
	}),
	importBatch: one(importBatches, {
		fields: [cases.importBatchId],
		references: [importBatches.id]
	}),
	org: one(orgs, {
		fields: [cases.ownerOrgId],
		references: [orgs.id]
	}),
	case: one(cases, {
		fields: [cases.previousCaseId],
		references: [cases.id],
		relationName: "cases_previousCaseId_cases_id"
	}),
	cases: many(cases, {
		relationName: "cases_previousCaseId_cases_id"
	}),
	user_qualifiedBy: one(users, {
		fields: [cases.qualifiedBy],
		references: [users.id],
		relationName: "cases_qualifiedBy_users_id"
	}),
	tenant: one(tenants, {
		fields: [cases.tenantId],
		references: [tenants.id]
	}),
	files: many(files),
	quotes: many(quotes),
	offers: many(offers),
	otpChallenges: many(otpChallenges),
}));

export const caseReturnsRelations = relations(caseReturns, ({one}) => ({
	case: one(cases, {
		fields: [caseReturns.caseId],
		references: [cases.id]
	}),
	user_returnedBy: one(users, {
		fields: [caseReturns.returnedBy],
		references: [users.id],
		relationName: "caseReturns_returnedBy_users_id"
	}),
	user_returnedTo: one(users, {
		fields: [caseReturns.returnedTo],
		references: [users.id],
		relationName: "caseReturns_returnedTo_users_id"
	}),
	tenant: one(tenants, {
		fields: [caseReturns.tenantId],
		references: [tenants.id]
	}),
}));

export const appointmentsRelations = relations(appointments, ({one, many}) => ({
	case: one(cases, {
		fields: [appointments.caseId],
		references: [cases.id]
	}),
	user: one(users, {
		fields: [appointments.createdBy],
		references: [users.id]
	}),
	epcPartner: one(epcPartners, {
		fields: [appointments.epcPartnerId],
		references: [epcPartners.id]
	}),
	appointment: one(appointments, {
		fields: [appointments.rescheduledFrom],
		references: [appointments.id],
		relationName: "appointments_rescheduledFrom_appointments_id"
	}),
	appointments: many(appointments, {
		relationName: "appointments_rescheduledFrom_appointments_id"
	}),
	tenant: one(tenants, {
		fields: [appointments.tenantId],
		references: [tenants.id]
	}),
}));

export const assessmentsRelations = relations(assessments, ({one, many}) => ({
	case: one(cases, {
		fields: [assessments.caseId],
		references: [cases.id]
	}),
	user_confirmedBy: one(users, {
		fields: [assessments.confirmedBy],
		references: [users.id],
		relationName: "assessments_confirmedBy_users_id"
	}),
	user_createdBy: one(users, {
		fields: [assessments.createdBy],
		references: [users.id],
		relationName: "assessments_createdBy_users_id"
	}),
	calcRelease: one(calcReleases, {
		fields: [assessments.releaseId],
		references: [calcReleases.id]
	}),
	tenant: one(tenants, {
		fields: [assessments.tenantId],
		references: [tenants.id]
	}),
	quotes: many(quotes),
}));

export const eligibilityChecksRelations = relations(eligibilityChecks, ({one, many}) => ({
	case: one(cases, {
		fields: [eligibilityChecks.caseId],
		references: [cases.id]
	}),
	user_decidedBy: one(users, {
		fields: [eligibilityChecks.decidedBy],
		references: [users.id],
		relationName: "eligibilityChecks_decidedBy_users_id"
	}),
	financier: one(financiers, {
		fields: [eligibilityChecks.financierId],
		references: [financiers.id]
	}),
	user_requestedBy: one(users, {
		fields: [eligibilityChecks.requestedBy],
		references: [users.id],
		relationName: "eligibilityChecks_requestedBy_users_id"
	}),
	tenant: one(tenants, {
		fields: [eligibilityChecks.tenantId],
		references: [tenants.id]
	}),
	eligibilityValues: many(eligibilityValues),
}));

export const quoteRequestsRelations = relations(quoteRequests, ({one, many}) => ({
	case: one(cases, {
		fields: [quoteRequests.caseId],
		references: [cases.id]
	}),
	epcPartner: one(epcPartners, {
		fields: [quoteRequests.epcPartnerId],
		references: [epcPartners.id]
	}),
	user: one(users, {
		fields: [quoteRequests.requestedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [quoteRequests.tenantId],
		references: [tenants.id]
	}),
	quotes: many(quotes),
}));

export const financingDecisionsRelations = relations(financingDecisions, ({one, many}) => ({
	case: one(cases, {
		fields: [financingDecisions.caseId],
		references: [cases.id]
	}),
	file: one(files, {
		fields: [financingDecisions.caseId],
		references: [files.id]
	}),
	financier: one(financiers, {
		fields: [financingDecisions.financierId],
		references: [financiers.id]
	}),
	user_recordedBy: one(users, {
		fields: [financingDecisions.recordedBy],
		references: [users.id],
		relationName: "financingDecisions_recordedBy_users_id"
	}),
	user_routedBy: one(users, {
		fields: [financingDecisions.routedBy],
		references: [users.id],
		relationName: "financingDecisions_routedBy_users_id"
	}),
	tenant: one(tenants, {
		fields: [financingDecisions.tenantId],
		references: [tenants.id]
	}),
	disbursements: many(disbursements),
	financingValues: many(financingValues),
}));

export const filesRelations = relations(files, ({one, many}) => ({
	financingDecisions: many(financingDecisions),
	fileAcceptances: many(fileAcceptances),
	quote: one(quotes, {
		fields: [files.caseId],
		references: [quotes.id]
	}),
	case: one(cases, {
		fields: [files.caseId],
		references: [cases.id]
	}),
	otpChallenge: one(otpChallenges, {
		fields: [files.caseId],
		references: [otpChallenges.id]
	}),
	tenant: one(tenants, {
		fields: [files.tenantId],
		references: [tenants.id]
	}),
}));

export const installationsRelations = relations(installations, ({one, many}) => ({
	case: one(cases, {
		fields: [installations.caseId],
		references: [cases.id]
	}),
	epcPartner: one(epcPartners, {
		fields: [installations.epcPartnerId],
		references: [epcPartners.id]
	}),
	tenant: one(tenants, {
		fields: [installations.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [installations.updatedBy],
		references: [users.id]
	}),
	installationEvents: many(installationEvents),
}));

export const downPaymentsRelations = relations(downPayments, ({one}) => ({
	case: one(cases, {
		fields: [downPayments.caseId],
		references: [cases.id]
	}),
	user: one(users, {
		fields: [downPayments.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [downPayments.tenantId],
		references: [tenants.id]
	}),
}));

export const disbursementsRelations = relations(disbursements, ({one}) => ({
	case: one(cases, {
		fields: [disbursements.caseId],
		references: [cases.id]
	}),
	financingDecision: one(financingDecisions, {
		fields: [disbursements.decisionId],
		references: [financingDecisions.id]
	}),
	user: one(users, {
		fields: [disbursements.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [disbursements.tenantId],
		references: [tenants.id]
	}),
}));

export const assetsRelations = relations(assets, ({one, many}) => ({
	case: one(cases, {
		fields: [assets.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [assets.tenantId],
		references: [tenants.id]
	}),
	emiStatusUpdates: many(emiStatusUpdates),
	assetEvents: many(assetEvents),
}));

export const emiStatusUpdatesRelations = relations(emiStatusUpdates, ({one}) => ({
	asset: one(assets, {
		fields: [emiStatusUpdates.assetId],
		references: [assets.id]
	}),
	user: one(users, {
		fields: [emiStatusUpdates.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [emiStatusUpdates.tenantId],
		references: [tenants.id]
	}),
}));

export const assetEventsRelations = relations(assetEvents, ({one}) => ({
	asset: one(assets, {
		fields: [assetEvents.assetId],
		references: [assets.id]
	}),
	user: one(users, {
		fields: [assetEvents.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [assetEvents.tenantId],
		references: [tenants.id]
	}),
}));

export const withdrawalsRelations = relations(withdrawals, ({one}) => ({
	case: one(cases, {
		fields: [withdrawals.caseId],
		references: [cases.id]
	}),
	user_confirmedBy: one(users, {
		fields: [withdrawals.confirmedBy],
		references: [users.id],
		relationName: "withdrawals_confirmedBy_users_id"
	}),
	user_requestedBy: one(users, {
		fields: [withdrawals.requestedBy],
		references: [users.id],
		relationName: "withdrawals_requestedBy_users_id"
	}),
	tenant: one(tenants, {
		fields: [withdrawals.tenantId],
		references: [tenants.id]
	}),
}));

export const documentsRelations = relations(documents, ({one, many}) => ({
	case: one(cases, {
		fields: [documents.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [documents.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [documents.uploadedBy],
		references: [users.id]
	}),
	quotes_documentId: many(quotes, {
		relationName: "quotes_documentId_documents_id"
	}),
	quotes_caseId: many(quotes, {
		relationName: "quotes_caseId_documents_id"
	}),
}));

export const notificationsRelations = relations(notifications, ({one}) => ({
	case: one(cases, {
		fields: [notifications.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [notifications.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [notifications.userId],
		references: [users.id]
	}),
}));

export const smsMessagesRelations = relations(smsMessages, ({one}) => ({
	case: one(cases, {
		fields: [smsMessages.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [smsMessages.tenantId],
		references: [tenants.id]
	}),
}));

export const outboxEventsRelations = relations(outboxEvents, ({one}) => ({
	tenant: one(tenants, {
		fields: [outboxEvents.tenantId],
		references: [tenants.id]
	}),
}));

export const funnelDailyRelations = relations(funnelDaily, ({one}) => ({
	tenant: one(tenants, {
		fields: [funnelDaily.tenantId],
		references: [tenants.id]
	}),
}));

export const eligibilityValuesRelations = relations(eligibilityValues, ({one}) => ({
	eligibilityCheck: one(eligibilityChecks, {
		fields: [eligibilityValues.eligibilityId],
		references: [eligibilityChecks.id]
	}),
	user: one(users, {
		fields: [eligibilityValues.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [eligibilityValues.tenantId],
		references: [tenants.id]
	}),
}));

export const financingValuesRelations = relations(financingValues, ({one}) => ({
	financingDecision: one(financingDecisions, {
		fields: [financingValues.decisionId],
		references: [financingDecisions.id]
	}),
	user: one(users, {
		fields: [financingValues.recordedBy],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [financingValues.tenantId],
		references: [tenants.id]
	}),
}));

export const tenantDomainsRelations = relations(tenantDomains, ({one}) => ({
	tenant: one(tenants, {
		fields: [tenantDomains.tenantId],
		references: [tenants.id]
	}),
}));

export const auditLogRelations = relations(auditLog, ({one}) => ({
	user: one(users, {
		fields: [auditLog.actorId],
		references: [users.id]
	}),
	tenant: one(tenants, {
		fields: [auditLog.tenantId],
		references: [tenants.id]
	}),
}));

export const activitiesRelations = relations(activities, ({one}) => ({
	user: one(users, {
		fields: [activities.actorId],
		references: [users.id]
	}),
	case: one(cases, {
		fields: [activities.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [activities.tenantId],
		references: [tenants.id]
	}),
}));

export const caseStageHistoryRelations = relations(caseStageHistory, ({one}) => ({
	user: one(users, {
		fields: [caseStageHistory.actorId],
		references: [users.id]
	}),
	case: one(cases, {
		fields: [caseStageHistory.caseId],
		references: [cases.id]
	}),
	tenant: one(tenants, {
		fields: [caseStageHistory.tenantId],
		references: [tenants.id]
	}),
}));

export const seatLedgerRelations = relations(seatLedger, ({one}) => ({
	user_actorId: one(users, {
		fields: [seatLedger.actorId],
		references: [users.id],
		relationName: "seatLedger_actorId_users_id"
	}),
	tenant: one(tenants, {
		fields: [seatLedger.tenantId],
		references: [tenants.id]
	}),
	user_userId: one(users, {
		fields: [seatLedger.userId],
		references: [users.id],
		relationName: "seatLedger_userId_users_id"
	}),
}));

export const installationEventsRelations = relations(installationEvents, ({one}) => ({
	user: one(users, {
		fields: [installationEvents.actorId],
		references: [users.id]
	}),
	installation: one(installations, {
		fields: [installationEvents.installationId],
		references: [installations.id]
	}),
	tenant: one(tenants, {
		fields: [installationEvents.tenantId],
		references: [tenants.id]
	}),
}));

export const fileAcceptancesRelations = relations(fileAcceptances, ({one}) => ({
	file: one(files, {
		fields: [fileAcceptances.caseId],
		references: [files.id]
	}),
	offer: one(offers, {
		fields: [fileAcceptances.caseId],
		references: [offers.id]
	}),
	otpChallenge: one(otpChallenges, {
		fields: [fileAcceptances.caseId],
		references: [otpChallenges.id]
	}),
	tenant: one(tenants, {
		fields: [fileAcceptances.tenantId],
		references: [tenants.id]
	}),
}));

export const offersRelations = relations(offers, ({one, many}) => ({
	fileAcceptances: many(fileAcceptances),
	case: one(cases, {
		fields: [offers.caseId],
		references: [cases.id]
	}),
	user: one(users, {
		fields: [offers.createdBy],
		references: [users.id]
	}),
	quote: one(quotes, {
		fields: [offers.caseId],
		references: [quotes.id]
	}),
	tenant: one(tenants, {
		fields: [offers.tenantId],
		references: [tenants.id]
	}),
	otpChallenges: many(otpChallenges),
}));

export const otpChallengesRelations = relations(otpChallenges, ({one, many}) => ({
	fileAcceptances: many(fileAcceptances),
	files: many(files),
	case: one(cases, {
		fields: [otpChallenges.caseId],
		references: [cases.id]
	}),
	offer: one(offers, {
		fields: [otpChallenges.caseId],
		references: [offers.id]
	}),
	tenant: one(tenants, {
		fields: [otpChallenges.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [otpChallenges.triggeredBy],
		references: [users.id]
	}),
}));

export const customersRelations = relations(customers, ({one, many}) => ({
	cases: many(cases),
	tenant: one(tenants, {
		fields: [customers.tenantId],
		references: [tenants.id]
	}),
}));

export const quotesRelations = relations(quotes, ({one, many}) => ({
	files: many(files),
	assessment: one(assessments, {
		fields: [quotes.assessmentId],
		references: [assessments.id]
	}),
	case: one(cases, {
		fields: [quotes.caseId],
		references: [cases.id]
	}),
	document_documentId: one(documents, {
		fields: [quotes.documentId],
		references: [documents.id],
		relationName: "quotes_documentId_documents_id"
	}),
	document_caseId: one(documents, {
		fields: [quotes.caseId],
		references: [documents.id],
		relationName: "quotes_caseId_documents_id"
	}),
	epcPartner: one(epcPartners, {
		fields: [quotes.epcPartnerId],
		references: [epcPartners.id]
	}),
	quoteRequest: one(quoteRequests, {
		fields: [quotes.quoteRequestId],
		references: [quoteRequests.id]
	}),
	tenant: one(tenants, {
		fields: [quotes.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [quotes.uploadedBy],
		references: [users.id]
	}),
	offers: many(offers),
}));

export const holidaysRelations = relations(holidays, ({one}) => ({
	tenant: one(tenants, {
		fields: [holidays.tenantId],
		references: [tenants.id]
	}),
}));

export const seatLimitsRelations = relations(seatLimits, ({one}) => ({
	tenant: one(tenants, {
		fields: [seatLimits.tenantId],
		references: [tenants.id]
	}),
}));

export const workingHoursRelations = relations(workingHours, ({one}) => ({
	tenant: one(tenants, {
		fields: [workingHours.tenantId],
		references: [tenants.id]
	}),
}));

export const settingsRelations = relations(settings, ({one}) => ({
	tenant: one(tenants, {
		fields: [settings.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [settings.updatedBy],
		references: [users.id]
	}),
}));

export const idempotencyKeysRelations = relations(idempotencyKeys, ({one}) => ({
	tenant: one(tenants, {
		fields: [idempotencyKeys.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [idempotencyKeys.userId],
		references: [users.id]
	}),
}));

export const trustedDevicesRelations = relations(trustedDevices, ({one}) => ({
	tenant: one(tenants, {
		fields: [trustedDevices.tenantId],
		references: [tenants.id]
	}),
	user: one(users, {
		fields: [trustedDevices.userId],
		references: [users.id]
	}),
}));