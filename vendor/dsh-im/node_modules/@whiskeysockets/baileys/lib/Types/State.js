import { Boom } from '@hapi/boom';
export var SyncState;
(function (SyncState) {
    /** The socket is connecting, but we haven't received pending notifications yet. */
    SyncState[SyncState["Connecting"] = 0] = "Connecting";
    /** Pending notifications received. Buffering events until we decide whether to sync or not. */
    SyncState[SyncState["AwaitingInitialSync"] = 1] = "AwaitingInitialSync";
    /** The initial app state sync (history, etc.) is in progress. Buffering continues. */
    SyncState[SyncState["Syncing"] = 2] = "Syncing";
    /** Initial sync is complete, or was skipped. The socket is fully operational and events are processed in real-time. */
    SyncState[SyncState["Online"] = 3] = "Online";
})(SyncState || (SyncState = {}));
export var ReachoutTimelockEnforcementType;
(function (ReachoutTimelockEnforcementType) {
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_ALCOHOL"] = "BIZ_COMMERCE_VIOLATION_ALCOHOL";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_ADULT"] = "BIZ_COMMERCE_VIOLATION_ADULT";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_ANIMALS"] = "BIZ_COMMERCE_VIOLATION_ANIMALS";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS"] = "BIZ_COMMERCE_VIOLATION_BODY_PARTS_FLUIDS";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_DATING"] = "BIZ_COMMERCE_VIOLATION_DATING";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS"] = "BIZ_COMMERCE_VIOLATION_DIGITAL_SERVICES_PRODUCTS";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_DRUGS"] = "BIZ_COMMERCE_VIOLATION_DRUGS";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC"] = "BIZ_COMMERCE_VIOLATION_DRUGS_ONLY_OTC";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_GAMBLING"] = "BIZ_COMMERCE_VIOLATION_GAMBLING";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_HEALTHCARE"] = "BIZ_COMMERCE_VIOLATION_HEALTHCARE";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY"] = "BIZ_COMMERCE_VIOLATION_REAL_FAKE_CURRENCY";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_SUPPLEMENTS"] = "BIZ_COMMERCE_VIOLATION_SUPPLEMENTS";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_TOBACCO"] = "BIZ_COMMERCE_VIOLATION_TOBACCO";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT"] = "BIZ_COMMERCE_VIOLATION_VIOLENT_CONTENT";
    ReachoutTimelockEnforcementType["BIZ_COMMERCE_VIOLATION_WEAPONS"] = "BIZ_COMMERCE_VIOLATION_WEAPONS";
    ReachoutTimelockEnforcementType["BIZ_QUALITY"] = "BIZ_QUALITY";
    /** This means there is no restriction */
    ReachoutTimelockEnforcementType["DEFAULT"] = "DEFAULT";
    ReachoutTimelockEnforcementType["WEB_COMPANION_ONLY"] = "WEB_COMPANION_ONLY";
})(ReachoutTimelockEnforcementType || (ReachoutTimelockEnforcementType = {}));
export var NewChatMessageCappingStatusType;
(function (NewChatMessageCappingStatusType) {
    NewChatMessageCappingStatusType["NONE"] = "NONE";
    NewChatMessageCappingStatusType["FIRST_WARNING"] = "FIRST_WARNING";
    NewChatMessageCappingStatusType["SECOND_WARNING"] = "SECOND_WARNING";
    NewChatMessageCappingStatusType["CAPPED"] = "CAPPED";
})(NewChatMessageCappingStatusType || (NewChatMessageCappingStatusType = {}));
export var NewChatMessageCappingMVStatusType;
(function (NewChatMessageCappingMVStatusType) {
    NewChatMessageCappingMVStatusType["NOT_ELIGIBLE"] = "NOT_ELIGIBLE";
    NewChatMessageCappingMVStatusType["NOT_ACTIVE"] = "NOT_ACTIVE";
    NewChatMessageCappingMVStatusType["ACTIVE"] = "ACTIVE";
    NewChatMessageCappingMVStatusType["ACTIVE_UPGRADE_AVAILABLE"] = "ACTIVE_UPGRADE_AVAILABLE";
})(NewChatMessageCappingMVStatusType || (NewChatMessageCappingMVStatusType = {}));
export var NewChatMessageCappingOTEStatusType;
(function (NewChatMessageCappingOTEStatusType) {
    NewChatMessageCappingOTEStatusType["NOT_ELIGIBLE"] = "NOT_ELIGIBLE";
    NewChatMessageCappingOTEStatusType["ELIGIBLE"] = "ELIGIBLE";
    NewChatMessageCappingOTEStatusType["ACTIVE_IN_CURRENT_CYCLE"] = "ACTIVE_IN_CURRENT_CYCLE";
    NewChatMessageCappingOTEStatusType["EXHAUSTED"] = "EXHAUSTED";
})(NewChatMessageCappingOTEStatusType || (NewChatMessageCappingOTEStatusType = {}));
//# sourceMappingURL=State.js.map