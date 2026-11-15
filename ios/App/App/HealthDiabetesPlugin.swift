// HealthDiabetesPlugin
//
// In-app Capacitor plugin that fills the gap left by @capgo/capacitor-health:
// reads insulinDelivery and dietaryCarbohydrates from HealthKit. We keep this
// local rather than forking @capgo so the diabetes-specific surface stays
// owned by LoopStack and the upstream plugin can remain narrow.
//
// Data exposed:
//   • insulinDelivery — IU per sample, with delivery reason (bolus | basal)
//   • dietaryCarbohydrates — grams per sample
//
// Authorization is requested per call. iOS only prompts the user the first
// time and intentionally hides the granted/denied state from third-party
// apps, so we proceed and detect denial via empty results.

import Foundation
import Capacitor
import HealthKit

@objc(HealthDiabetesPlugin)
public class HealthDiabetesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthDiabetesPlugin"
    public let jsName = "HealthDiabetes"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readInsulin", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readCarbs", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBoluses", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "aggregateInsulinByDay", returnType: CAPPluginReturnPromise),
    ]

    private let healthStore = HKHealthStore()

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve([
            "available": HKHealthStore.isHealthDataAvailable(),
        ])
    }

    @objc func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("HealthKit not available on this device.")
            return
        }
        guard
            let insulinType = HKQuantityType.quantityType(forIdentifier: .insulinDelivery),
            let carbsType = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates)
        else {
            call.reject("Required HealthKit types not available.")
            return
        }

        let readSet: Set<HKObjectType> = [insulinType, carbsType]
        // We don't write — pass empty share set. The two-arg call is the
        // standard pattern even when share is empty.
        healthStore.requestAuthorization(toShare: [], read: readSet) { success, error in
            if let error = error {
                call.reject("Authorization failed: \(error.localizedDescription)")
                return
            }
            // success == true means iOS handled the prompt; it doesn't tell us
            // which permissions were actually granted. The caller treats empty
            // read results as soft-denied.
            call.resolve(["requested": success])
        }
    }

    @objc func readInsulin(_ call: CAPPluginCall) {
        guard let insulinType = HKQuantityType.quantityType(forIdentifier: .insulinDelivery) else {
            call.reject("insulinDelivery type unavailable.")
            return
        }
        let (start, end, limit) = parseTimeRange(call)

        let predicate = HKQuery.predicateForSamples(
            withStart: start, end: end, options: .strictStartDate
        )
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(
            sampleType: insulinType,
            predicate: predicate,
            limit: limit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                call.reject("Insulin query failed: \(error.localizedDescription)")
                return
            }
            let unit = HKUnit.internationalUnit()
            let mapped: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { sample in
                let units = sample.quantity.doubleValue(for: unit)
                let reason = (sample.metadata?[HKMetadataKeyInsulinDeliveryReason] as? Int) ?? 0
                return [
                    "iso": ISO8601DateFormatter.shared.string(from: sample.startDate),
                    "endIso": ISO8601DateFormatter.shared.string(from: sample.endDate),
                    "units": units,
                    // 1 = basal, 2 = bolus per HKInsulinDeliveryReason. 0 means
                    // the writing app didn't tag — we surface as "unknown".
                    "reason": reason == 1 ? "basal" : (reason == 2 ? "bolus" : "unknown"),
                    "sourceName": sample.sourceRevision.source.name,
                    "uuid": sample.uuid.uuidString,
                ]
            }
            call.resolve(["samples": mapped])
        }
        healthStore.execute(query)
    }

    @objc func readCarbs(_ call: CAPPluginCall) {
        guard let carbsType = HKQuantityType.quantityType(forIdentifier: .dietaryCarbohydrates) else {
            call.reject("dietaryCarbohydrates type unavailable.")
            return
        }
        let (start, end, limit) = parseTimeRange(call)

        let predicate = HKQuery.predicateForSamples(
            withStart: start, end: end, options: .strictStartDate
        )
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(
            sampleType: carbsType,
            predicate: predicate,
            limit: limit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                call.reject("Carbs query failed: \(error.localizedDescription)")
                return
            }
            let unit = HKUnit.gram()
            let mapped: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { sample in
                let grams = sample.quantity.doubleValue(for: unit)
                // Loop sets HKMetadataKeyFoodType when known; we forward it
                // verbatim as an optional `label`.
                let label = sample.metadata?[HKMetadataKeyFoodType] as? String
                // Loop also stores absorption time as a custom metadata key
                // ("com.loopkit.AbsorptionTime", value in seconds). Surface it
                // when present so the meal-trace computer can use Loop's own
                // value rather than re-modeling.
                let absorptionSec = sample.metadata?["com.loopkit.AbsorptionTime"] as? Double
                var entry: [String: Any] = [
                    "iso": ISO8601DateFormatter.shared.string(from: sample.startDate),
                    "endIso": ISO8601DateFormatter.shared.string(from: sample.endDate),
                    "grams": grams,
                    "sourceName": sample.sourceRevision.source.name,
                    "uuid": sample.uuid.uuidString,
                ]
                if let label = label { entry["label"] = label }
                if let absorptionSec = absorptionSec {
                    entry["absorptionHours"] = absorptionSec / 3600.0
                }
                return entry
            }
            call.resolve(["samples": mapped])
        }
        healthStore.execute(query)
    }

    /// Bolus-only insulin read. Loop writes a temp-basal insulinDelivery sample
    /// every few minutes, so reading *all* insulin over a multi-week window
    /// returns tens of thousands of samples. The meal-trace engine only needs
    /// the (sparse) boluses, so filter on the delivery-reason metadata here.
    @objc func readBoluses(_ call: CAPPluginCall) {
        guard let insulinType = HKQuantityType.quantityType(forIdentifier: .insulinDelivery) else {
            call.reject("insulinDelivery type unavailable.")
            return
        }
        let (start, end, limit) = parseTimeRange(call)

        let datePredicate = HKQuery.predicateForSamples(
            withStart: start, end: end, options: .strictStartDate
        )
        // HKInsulinDeliveryReason.bolus == 2.
        let bolusPredicate = HKQuery.predicateForObjects(
            withMetadataKey: HKMetadataKeyInsulinDeliveryReason,
            operatorType: .equalTo,
            value: NSNumber(value: 2)
        )
        let predicate = NSCompoundPredicate(andPredicateWithSubpredicates: [datePredicate, bolusPredicate])
        let sort = NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)
        let query = HKSampleQuery(
            sampleType: insulinType,
            predicate: predicate,
            limit: limit,
            sortDescriptors: [sort]
        ) { _, samples, error in
            if let error = error {
                call.reject("Bolus query failed: \(error.localizedDescription)")
                return
            }
            let unit = HKUnit.internationalUnit()
            let mapped: [[String: Any]] = (samples as? [HKQuantitySample] ?? []).map { sample in
                [
                    "iso": ISO8601DateFormatter.shared.string(from: sample.startDate),
                    "endIso": ISO8601DateFormatter.shared.string(from: sample.endDate),
                    "units": sample.quantity.doubleValue(for: unit),
                    "reason": "bolus",
                    "sourceName": sample.sourceRevision.source.name,
                    "uuid": sample.uuid.uuidString,
                ]
            }
            call.resolve(["samples": mapped])
        }
        healthStore.execute(query)
    }

    /// Daily insulin totals, split into basal vs bolus. Reads all insulin
    /// samples in the window and buckets them natively (by local calendar day)
    /// so only ~N day-rows cross the bridge, not N thousand samples. Used for
    /// the metrics dashboard's basal/bolus figures.
    @objc func aggregateInsulinByDay(_ call: CAPPluginCall) {
        guard let insulinType = HKQuantityType.quantityType(forIdentifier: .insulinDelivery) else {
            call.reject("insulinDelivery type unavailable.")
            return
        }
        let (start, end, _) = parseTimeRange(call)
        let predicate = HKQuery.predicateForSamples(
            withStart: start, end: end, options: .strictStartDate
        )
        // No limit cap — we need every sample to sum correctly. HealthKit
        // streams them into the native callback; we reduce before returning.
        let query = HKSampleQuery(
            sampleType: insulinType,
            predicate: predicate,
            limit: HKObjectQueryNoLimit,
            sortDescriptors: nil
        ) { _, samples, error in
            if let error = error {
                call.reject("Insulin aggregate failed: \(error.localizedDescription)")
                return
            }
            let unit = HKUnit.internationalUnit()
            let cal = Calendar.current
            // dayKey (start-of-day) → (basal, bolus)
            var buckets: [Date: (basal: Double, bolus: Double)] = [:]
            // Duplicate suppression, mirroring lib/metabolism/dedupe.ts. When two
            // apps (or one app on two devices) write insulinDelivery into the
            // same Health store, the identical delivery lands twice under
            // different UUIDs and every daily total comes out inflated. Identity
            // is amount + reason + start minute; summing happens after.
            var seen = Set<String>()
            for sample in (samples as? [HKQuantitySample] ?? []) {
                let units = sample.quantity.doubleValue(for: unit)
                let reason = (sample.metadata?[HKMetadataKeyInsulinDeliveryReason] as? Int) ?? 0
                let minute = Int(sample.startDate.timeIntervalSince1970 / 60)
                let key = "\(minute)|\(reason)|\(Int((units * 1000).rounded()))"
                if seen.contains(key) { continue }
                seen.insert(key)

                let day = cal.startOfDay(for: sample.startDate)
                var entry = buckets[day] ?? (basal: 0, bolus: 0)
                if reason == 2 { entry.bolus += units } else { entry.basal += units }
                buckets[day] = entry
            }
            let days: [[String: Any]] = buckets
                .sorted { $0.key < $1.key }
                .map { (day, v) in
                    [
                        "dayIso": ISO8601DateFormatter.shared.string(from: day),
                        "basal": v.basal,
                        "bolus": v.bolus,
                    ]
                }
            call.resolve(["days": days])
        }
        healthStore.execute(query)
    }

    /// Pull startDate / endDate / limit from the plugin call. Defaults: last
    /// 24 hours, 500 samples.
    private func parseTimeRange(_ call: CAPPluginCall) -> (Date, Date, Int) {
        let now = Date()
        let formatter = ISO8601DateFormatter.shared
        let start: Date = {
            if let s = call.getString("startDate"), let d = formatter.date(from: s) { return d }
            return now.addingTimeInterval(-24 * 3600)
        }()
        let end: Date = {
            if let s = call.getString("endDate"), let d = formatter.date(from: s) { return d }
            return now
        }()
        let limit = call.getInt("limit") ?? 500
        return (start, end, limit)
    }
}

// Shared ISO formatter — HKSampleQuery callbacks fire on background threads,
// and constructing ISO8601DateFormatter is non-trivial. One static instance
// avoids per-sample allocation across thousands of carb/insulin entries.
fileprivate extension ISO8601DateFormatter {
    static let shared: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
}

// Bridge view controller that registers the in-app plugin.
//
// Capacitor 6+ stopped honoring the legacy CAP_PLUGIN macro for classes that
// live in the app target — packaged (SPM/pod) plugins auto-register, local
// ones must be attached to the bridge explicitly. Main.storyboard points its
// root view controller here so this runs at startup; without it, every
// HealthDiabetes.* call from JS dies with "plugin is not implemented".
@objc(MainViewController)
class MainViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthDiabetesPlugin())
    }
}
