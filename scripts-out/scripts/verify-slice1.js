"use strict";
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var prisma_1 = __importDefault(require("../src/db/prisma"));
var forecast_1 = require("../src/services/forecast");
var baseline_1 = require("../src/services/baseline");
function run() {
    return __awaiter(this, void 0, void 0, function () {
        var companyId, cashSnapshot, cashAdjustments, adjustmentsTotal, openingCash, invoicesRaw, billsRaw, recurringPatternsRaw, assumptionsRaw, assumptions, txs, bankTxsForBaseline, patternsForBaseline, baseline, hasBankBaseline, buildInput, parsedInvs, parsedBills, inputBase, fcBase, w1InvoiceItem, w1Invoice_1, d_1, newInvs, fcAR, w1BaseStart, w1BaseEnd, w2BaseStart, w1ARStart, w1AREnd, w2ARStart, excInvs, fcExc, w1BillItem, w1Bill_1, d_2, newBills, fcAP, w1BaseStart, w1BaseEnd, w2BaseStart, w1APStart, w1APEnd, w2APStart;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    companyId = "6f8b9b14-4b04-48dd-988b-4d28bef4ec16";
                    return [4 /*yield*/, prisma_1.default.cashSnapshot.findFirst({
                            where: { companyId: companyId },
                            orderBy: { asOfDate: 'desc' }
                        })];
                case 1:
                    cashSnapshot = _a.sent();
                    return [4 /*yield*/, prisma_1.default.cashAdjustment.findMany({ where: { companyId: companyId } })];
                case 2:
                    cashAdjustments = _a.sent();
                    adjustmentsTotal = cashAdjustments.reduce(function (s, a) { return s + a.amount; }, 0);
                    openingCash = cashSnapshot.bankBalance + adjustmentsTotal;
                    return [4 /*yield*/, prisma_1.default.receivableInvoice.findMany({ where: { companyId: companyId } })];
                case 3:
                    invoicesRaw = _a.sent();
                    return [4 /*yield*/, prisma_1.default.payableBill.findMany({ where: { companyId: companyId } })];
                case 4:
                    billsRaw = _a.sent();
                    return [4 /*yield*/, prisma_1.default.recurringPattern.findMany({ where: { companyId: companyId } })];
                case 5:
                    recurringPatternsRaw = _a.sent();
                    return [4 /*yield*/, prisma_1.default.assumption.findFirst({ where: { companyId: companyId } })];
                case 6:
                    assumptionsRaw = _a.sent();
                    assumptions = assumptionsRaw || {
                        bufferMin: 10000, fixedWeeklyOutflow: 0, payrollCadence: "biweekly",
                        payrollAllInAmount: null, payrollNextDate: null, rentMonthlyAmount: null,
                        rentDayOfMonth: null, paymentCurveJson: "{}", highRiskAgingDays: 61,
                        projectionSafetyMargin: 1.0
                    };
                    return [4 /*yield*/, prisma_1.default.bankTransaction.findMany({
                            where: { companyId: companyId }, orderBy: { txDate: 'desc' }, take: 1000
                        })];
                case 7:
                    txs = _a.sent();
                    bankTxsForBaseline = txs.map(function (t) { return ({ amount: t.amount, date: t.txDate, merchantKey: t.description }); });
                    patternsForBaseline = recurringPatternsRaw.map(function (rp) {
                        var _a, _b, _c;
                        return ({
                            merchantKey: (_a = rp.merchantKey) !== null && _a !== void 0 ? _a : rp.displayName,
                            direction: rp.direction,
                            category: rp.category,
                            isIncluded: rp.isIncluded,
                            typicalAmount: (_b = rp.typicalAmount) !== null && _b !== void 0 ? _b : 0,
                            amountStdDev: (_c = rp.amountStdDev) !== null && _c !== void 0 ? _c : 0,
                        });
                    });
                    baseline = (0, baseline_1.computeBaseline)(bankTxsForBaseline, patternsForBaseline, cashSnapshot.asOfDate);
                    hasBankBaseline = baseline.hasSufficientHistory;
                    buildInput = function (invs, bls) {
                        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
                        return ({
                            adjustedOpeningCash: openingCash,
                            bankBalance: cashSnapshot.bankBalance,
                            adjustmentsTotal: adjustmentsTotal,
                            asOfDate: cashSnapshot.asOfDate,
                            invoices: invs,
                            bills: bls,
                            recurring: recurringPatternsRaw.map(function (rp) { return (__assign(__assign({}, rp), { direction: rp.direction, confidence: rp.confidence })); }),
                            assumptions: {
                                bufferMin: (_a = assumptions.bufferMin) !== null && _a !== void 0 ? _a : 10000,
                                fixedWeeklyOutflow: (_b = assumptions.fixedWeeklyOutflow) !== null && _b !== void 0 ? _b : 0,
                                payrollCadence: (_c = assumptions.payrollCadence) !== null && _c !== void 0 ? _c : "biweekly",
                                payrollAllInAmount: (_d = assumptions.payrollAllInAmount) !== null && _d !== void 0 ? _d : null,
                                payrollNextDate: (_e = assumptions.payrollNextDate) !== null && _e !== void 0 ? _e : null,
                                rentMonthlyAmount: (_f = assumptions.rentMonthlyAmount) !== null && _f !== void 0 ? _f : null,
                                rentDayOfMonth: (_g = assumptions.rentDayOfMonth) !== null && _g !== void 0 ? _g : null,
                                paymentCurveJson: assumptions.paymentCurveJson || "{}",
                                highRiskAgingDays: (_h = assumptions.highRiskAgingDays) !== null && _h !== void 0 ? _h : 61,
                                projectionSafetyMargin: (_j = assumptions.projectionSafetyMargin) !== null && _j !== void 0 ? _j : 1.0,
                            },
                            hasBankBaseline: hasBankBaseline,
                            variableOutflowWeekly: baseline.variableOutflowWeekly,
                            variableOutflowBand: baseline.variableOutflowBand,
                            baselineInflowWeekly: baseline.variableInflowWeekly,
                            baselineInflowBand: baseline.variableInflowBand,
                            oneTimeOutflows: [],
                        });
                    };
                    parsedInvs = invoicesRaw.map(function (i) { return (__assign(__assign({}, i), { markedPaid: false, overrideAmount: null, overrideExpectedDate: null, partialPayment: null, riskTag: undefined, typicalDelayWeeks: undefined })); });
                    parsedBills = billsRaw.map(function (b) { return (__assign(__assign({}, b), { markedPaid: false, overrideAmount: null, overrideDueDate: null, criticality: undefined })); });
                    inputBase = buildInput(parsedInvs, parsedBills);
                    fcBase = (0, forecast_1.computeForecast)(inputBase);
                    w1InvoiceItem = fcBase.weeks[0].breakdown.inflows.find(function (i) { return i.sourceType === "invoice" && i.amount > 0; });
                    if (w1InvoiceItem && w1InvoiceItem.sourceId) {
                        w1Invoice_1 = parsedInvs.find(function (i) { return i.id === w1InvoiceItem.sourceId; });
                        if (w1Invoice_1) {
                            d_1 = new Date(w1Invoice_1.overrideExpectedDate || w1Invoice_1.dueDate || w1Invoice_1.invoiceDate || cashSnapshot.asOfDate);
                            d_1.setDate(d_1.getDate() + 7);
                            newInvs = parsedInvs.map(function (i) { return i.id === w1Invoice_1.id ? __assign(__assign({}, i), { overrideExpectedDate: d_1 }) : i; });
                            fcAR = (0, forecast_1.computeForecast)(buildInput(newInvs, parsedBills));
                            w1BaseStart = fcBase.weeks[0].startCash;
                            w1BaseEnd = fcBase.weeks[0].endCashExpected;
                            w2BaseStart = fcBase.weeks[1].startCash;
                            w1ARStart = fcAR.weeks[0].startCash;
                            w1AREnd = fcAR.weeks[0].endCashExpected;
                            w2ARStart = fcAR.weeks[1].startCash;
                            console.log("AR Move Test:");
                            console.log("W1 Start: ".concat(w1BaseStart, " -> ").concat(w1ARStart, " (Passed: ").concat(w1ARStart === w1BaseStart, ")"));
                            console.log("W1 End: ".concat(w1BaseEnd, " -> ").concat(w1AREnd, " (Passed: ").concat(w1AREnd === w1BaseEnd - w1InvoiceItem.amount, ")"));
                            console.log("W2 Start: ".concat(w2BaseStart, " -> ").concat(w2ARStart, " (Passed: ").concat(w2ARStart === w2BaseStart - w1InvoiceItem.amount, ")"));
                            excInvs = parsedInvs.filter(function (i) { return i.id !== w1Invoice_1.id; });
                            fcExc = (0, forecast_1.computeForecast)(buildInput(excInvs, parsedBills));
                            console.log("AR Exclude Test:");
                            console.log("W1 Start: ".concat(fcExc.weeks[0].startCash, " (Passed: ").concat(fcExc.weeks[0].startCash === w1BaseStart, ")"));
                            console.log("W1 End: ".concat(fcExc.weeks[0].endCashExpected, " (Passed: ").concat(fcExc.weeks[0].endCashExpected === w1BaseEnd - w1InvoiceItem.amount, ")"));
                            console.log("W2 Start: ".concat(fcExc.weeks[1].startCash, " (Passed: ").concat(fcExc.weeks[1].startCash === w2BaseStart - w1InvoiceItem.amount, ")"));
                        }
                    }
                    else {
                        console.log("No W1 AR found for test");
                    }
                    w1BillItem = fcBase.weeks[0].breakdown.outflows.find(function (i) { return i.sourceType === "bill" && i.amount > 0; });
                    if (w1BillItem && w1BillItem.sourceId) {
                        w1Bill_1 = parsedBills.find(function (b) { return b.id === w1BillItem.sourceId; });
                        if (w1Bill_1) {
                            d_2 = new Date(w1Bill_1.overrideDueDate || w1Bill_1.dueDate || w1Bill_1.billDate || cashSnapshot.asOfDate);
                            d_2.setDate(d_2.getDate() + 7);
                            newBills = parsedBills.map(function (b) { return b.id === w1Bill_1.id ? __assign(__assign({}, b), { overrideDueDate: d_2 }) : b; });
                            fcAP = (0, forecast_1.computeForecast)(buildInput(parsedInvs, newBills));
                            w1BaseStart = fcBase.weeks[0].startCash;
                            w1BaseEnd = fcBase.weeks[0].endCashExpected;
                            w2BaseStart = fcBase.weeks[1].startCash;
                            w1APStart = fcAP.weeks[0].startCash;
                            w1APEnd = fcAP.weeks[0].endCashExpected;
                            w2APStart = fcAP.weeks[1].startCash;
                            console.log("AP Move Test:");
                            console.log("W1 Start: ".concat(w1BaseStart, " -> ").concat(w1APStart, " (Passed: ").concat(w1APStart === w1BaseStart, ")"));
                            console.log("W1 End: ".concat(w1BaseEnd, " -> ").concat(w1APEnd, " (Passed: ").concat(w1APEnd === w1BaseEnd + w1BillItem.amount, ")"));
                            console.log("W2 Start: ".concat(w2BaseStart, " -> ").concat(w2APStart, " (Passed: ").concat(w2APStart === w2BaseStart + w1BillItem.amount, ")"));
                        }
                    }
                    else {
                        console.log("No W1 AP found for test");
                    }
                    return [2 /*return*/];
            }
        });
    });
}
run();
