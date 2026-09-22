import { describe, expect, it } from "vitest";
import {
  createGenerativeFormState,
  createGenerativeFormSubmissionController,
  dispatchGenerativeFormChange,
  generativeFormReducer,
  isGenerativeFormEditable,
} from "./generative-form-state";

describe("generativeFormReducer", () => {
  it("only enters submitted after a successful send", () => {
    const initial = createGenerativeFormState({ name: "Ada" });
    const submitting = generativeFormReducer(initial, { type: "submit_started" });
    const submitted = generativeFormReducer(submitting, { type: "submit_resolved", sent: true });
    expect(submitting.status).toBe("submitting");
    expect(submitted.status).toBe("submitted");
  });

  it("returns to an editable error state when sending returns false", () => {
    const initial = createGenerativeFormState({ name: "Ada" });
    const submitting = generativeFormReducer(initial, { type: "submit_started" });
    const failed = generativeFormReducer(submitting, { type: "submit_resolved", sent: false });
    expect(failed).toEqual({ status: "error", values: { name: "Ada" }, error: "提交失败，请重试" });
  });

  it("prevents duplicate submit transitions and clears error when editing", () => {
    const initial = createGenerativeFormState({ name: "Ada" });
    const submitting = generativeFormReducer(initial, { type: "submit_started" });
    expect(generativeFormReducer(submitting, { type: "submit_started" })).toBe(submitting);
    const failed = generativeFormReducer(submitting, { type: "submit_resolved", sent: false });
    const edited = generativeFormReducer(failed, {
      type: "field_changed",
      field: "name",
      value: "Grace",
    });
    expect(edited).toEqual({ status: "editable", values: { name: "Grace" }, error: null });
  });
});

describe("GenerativeFormSubmissionController", () => {
  it("allows only one synchronous begin before completion", () => {
    const controller = createGenerativeFormSubmissionController();
    controller.mount();
    expect(controller.begin()).toBe(true);
    expect(controller.begin()).toBe(false);
  });

  it("unlocks after false or rejection-equivalent completion and locks permanently after success", () => {
    const controller = createGenerativeFormSubmissionController();
    controller.mount();
    expect(controller.begin()).toBe(true);
    expect(controller.complete(false)).toBe(true);
    expect(controller.begin()).toBe(true);
    expect(controller.complete(false)).toBe(true);
    expect(controller.begin()).toBe(true);
    expect(controller.complete(true)).toBe(true);
    expect(controller.begin()).toBe(false);
  });

  it("accepts completion after strict-effects remount and ignores completion while unmounted", () => {
    const controller = createGenerativeFormSubmissionController();
    controller.mount();
    expect(controller.begin()).toBe(true);
    controller.unmount();
    controller.mount();
    expect(controller.complete(false)).toBe(true);
    expect(controller.begin()).toBe(true);
    controller.unmount();
    expect(controller.complete(false)).toBe(false);
    controller.mount();
    expect(controller.begin()).toBe(true);
  });
});

describe("isGenerativeFormEditable", () => {
  it("allows editable and error states but locks submitting and submitted states", () => {
    const editable = createGenerativeFormState({ name: "Ada" });
    const submitting = generativeFormReducer(editable, { type: "submit_started" });
    const submitted = generativeFormReducer(submitting, { type: "submit_resolved", sent: true });
    const error = generativeFormReducer(submitting, { type: "submit_resolved", sent: false });
    expect(isGenerativeFormEditable(editable)).toBe(true);
    expect(isGenerativeFormEditable(error)).toBe(true);
    expect(isGenerativeFormEditable(submitting)).toBe(false);
    expect(isGenerativeFormEditable(submitted)).toBe(false);
  });
});

describe("dispatchGenerativeFormChange", () => {
  it("does not dispatch or send while locked and allows editable errors", () => {
    const calls: string[] = [];
    const editable = createGenerativeFormState({ name: "Ada" });
    const submitting = generativeFormReducer(editable, { type: "submit_started" });
    const submitted = generativeFormReducer(submitting, { type: "submit_resolved", sent: true });
    const error = generativeFormReducer(submitting, { type: "submit_resolved", sent: false });
    const controller = createGenerativeFormSubmissionController();
    controller.mount();
    expect(
      dispatchGenerativeFormChange(submitting, controller, () => calls.push("submitting")),
    ).toBe(false);
    expect(dispatchGenerativeFormChange(submitted, controller, () => calls.push("submitted"))).toBe(
      false,
    );
    expect(dispatchGenerativeFormChange(error, controller, () => calls.push("error"))).toBe(true);
    expect(dispatchGenerativeFormChange(editable, controller, () => calls.push("editable"))).toBe(
      true,
    );
    expect(calls).toEqual(["error", "editable"]);
  });

  it("blocks same-tick text and select changes after begin before a reducer transition", () => {
    const controller = createGenerativeFormSubmissionController();
    const editable = createGenerativeFormState({ name: "Ada" });
    const calls: string[] = [];
    controller.mount();
    expect(controller.begin()).toBe(true);
    expect(dispatchGenerativeFormChange(editable, controller, () => calls.push("text"))).toBe(
      false,
    );
    expect(dispatchGenerativeFormChange(editable, controller, () => calls.push("select"))).toBe(
      false,
    );
    expect(calls).toEqual([]);

    expect(controller.complete(false)).toBe(true);
    expect(dispatchGenerativeFormChange(editable, controller, () => calls.push("retry"))).toBe(
      true,
    );
    expect(calls).toEqual(["retry"]);

    expect(controller.begin()).toBe(true);
    expect(controller.complete(true)).toBe(true);
    expect(
      dispatchGenerativeFormChange(editable, controller, () => calls.push("after-success")),
    ).toBe(false);
    expect(calls).toEqual(["retry"]);
  });
});
