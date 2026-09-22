import React, { useMemo, useCallback, useEffect, useReducer, useRef } from "react";
import { View, Text, TextInput, TouchableOpacity, ScrollView } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import type { GenerativeUiComponentBaseProps } from "@/generative-ui/registry/types";
import {
  createGenerativeFormState,
  createGenerativeFormSubmissionController,
  dispatchGenerativeFormChange,
  generativeFormReducer,
  isGenerativeFormEditable,
} from "@/generative-ui/components/generative-form-state";

interface FormField {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "textarea" | "date";
  placeholder?: string;
  required?: boolean;
  options?: { label: string; value: string }[];
}

interface FormProps extends GenerativeUiComponentBaseProps {
  props: {
    title?: string;
    fields: FormField[];
    submitLabel?: string;
  };
}

const accessibilityDisabledState = { disabled: true } as const;
const accessibilityEnabledState = { disabled: false } as const;

function FormFieldRenderer({
  field,
  value,
  disabled,
  onChange,
  onSelectOption,
}: {
  field: FormField;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onSelectOption: (optValue: string) => void;
}) {
  const optionHandlers = useMemo(
    () =>
      (field.options ?? []).map(
        (opt) =>
          function handleOptionPress() {
            onSelectOption(opt.value);
          },
      ),
    [field.options, onSelectOption],
  );

  if (field.type === "select" && field.options) {
    return (
      <View style={styles.selectRow}>
        {field.options.map((opt, i) => (
          <TouchableOpacity
            key={opt.value}
            onPress={optionHandlers[i]}
            disabled={disabled}
            accessibilityState={disabled ? accessibilityDisabledState : accessibilityEnabledState}
            style={value === opt.value ? styles.optionButtonSelected : styles.optionButton}
          >
            <Text style={value === opt.value ? styles.optionTextSelected : styles.optionText}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  if (field.type === "textarea") {
    return (
      <TextInput
        style={styles.textarea}
        multiline
        numberOfLines={3}
        value={value}
        onChangeText={onChange}
        placeholder={field.placeholder}
        editable={!disabled}
        placeholderTextColor={styles.placeholder.color}
      />
    );
  }

  const keyboardType = field.type === "number" ? "numeric" : "default";

  return (
    <TextInput
      style={styles.input}
      value={value}
      onChangeText={onChange}
      placeholder={field.placeholder}
      keyboardType={keyboardType}
      editable={!disabled}
      placeholderTextColor={styles.placeholder.color}
    />
  );
}

export default function GenerativeFormCard({ instanceId, props, sendAction }: FormProps) {
  const fields = props.fields ?? [];

  const [state, dispatch] = useReducer(generativeFormReducer, fields, (initialFields) => {
    const initial: Record<string, string> = {};
    for (const field of initialFields) initial[field.name] = "";
    return createGenerativeFormState(initial);
  });
  const submissionControllerRef = useRef(createGenerativeFormSubmissionController());
  useEffect(() => {
    const controller = submissionControllerRef.current;
    controller.mount();
    return () => controller.unmount();
  }, []);

  const handleChange = useCallback(
    (name: string, value: string) => {
      dispatchGenerativeFormChange(state, submissionControllerRef.current, () => {
        dispatch({ type: "field_changed", field: name, value });
        void sendAction(instanceId, "change", { field: name, value });
      });
    },
    [instanceId, sendAction, state],
  );

  const handleSubmit = useCallback(async () => {
    if (!submissionControllerRef.current.begin()) return;
    dispatch({ type: "submit_started" });
    let sent = false;
    try {
      sent = await sendAction(instanceId, "submit", { values: state.values });
    } catch {
      sent = false;
    }
    if (submissionControllerRef.current.complete(sent)) {
      dispatch({ type: "submit_resolved", sent });
    }
  }, [instanceId, sendAction, state.values]);

  const disabled = !isGenerativeFormEditable(state);
  const submitButtonStyle = useMemo(
    () => (disabled ? styles.submitButtonDisabled : styles.submitButton),
    [disabled],
  );

  const changeHandlers = useMemo(
    () =>
      fields.map(
        (field) =>
          function createChangeHandler(v: string) {
            handleChange(field.name, v);
          },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, handleChange],
  );

  const selectOptionHandlers = useMemo(
    () =>
      fields.map(
        (field) =>
          function createSelectHandler(optValue: string) {
            handleChange(field.name, optValue);
          },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fields, handleChange],
  );

  return (
    <View style={styles.container}>
      {props.title ? <Text style={styles.title}>{props.title}</Text> : null}

      <ScrollView>
        {fields.map((field, fieldIdx) => (
          <View key={field.name} style={styles.fieldWrapper}>
            <Text style={styles.label}>
              {field.label}
              {field.required ? <Text style={styles.requiredStar}> *</Text> : null}
            </Text>
            <FormFieldRenderer
              field={field}
              value={state.values[field.name] ?? ""}
              disabled={disabled}
              onChange={changeHandlers[fieldIdx]}
              onSelectOption={selectOptionHandlers[fieldIdx]}
            />
          </View>
        ))}
      </ScrollView>

      {state.error ? <Text style={styles.errorText}>{state.error}</Text> : null}
      <TouchableOpacity onPress={handleSubmit} disabled={disabled} style={submitButtonStyle}>
        <Text style={styles.submitText}>
          {state.status === "submitted" ? "已提交" : (props.submitLabel ?? "提交")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Soft stream form card: quiet elevated surface0.
  container: {
    padding: 12,
    borderRadius: 14,
    backgroundColor: theme.colors.surface0,
    borderWidth: 1,
    borderColor: theme.colors.border,
    ...(isWeb
      ? ({
          boxShadow: "0 1px 2px rgba(20, 23, 31, 0.04), 0 8px 24px rgba(20, 23, 31, 0.06)",
        } as object)
      : theme.shadow.sm),
  },
  title: {
    fontSize: 14.5,
    lineHeight: 20,
    fontWeight: theme.fontWeight.semibold,
    color: theme.colors.foreground,
    marginBottom: 12,
  },
  fieldWrapper: {
    marginBottom: 12,
  },
  label: {
    fontSize: 12.5,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foregroundSubtleText,
    marginBottom: 4,
  },
  requiredStar: {
    color: theme.colors.destructive,
  },
  selectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 4,
  },
  optionButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    // Soft quiet chip: r10 control family.
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  optionButtonSelected: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.accent,
    // Soft selected chip: surface3 wash under accent edge.
    backgroundColor: theme.colors.surface3,
  },
  optionText: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.foregroundSubtleText,
  },
  optionTextSelected: {
    fontSize: 12.5,
    lineHeight: 16,
    color: theme.colors.accent,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    padding: 8,
    // Soft form field body: 14.5 readability.
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
  },
  textarea: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    padding: 8,
    // Soft form field body: 14.5 readability.
    fontSize: 14.5,
    lineHeight: 22,
    color: theme.colors.foreground,
    backgroundColor: theme.colors.surface0,
    minHeight: 72,
    textAlignVertical: "top",
  },
  placeholder: {
    color: theme.colors.foregroundFaint,
  },
  submitButton: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: theme.colors.accent,
  },
  submitButtonDisabled: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: theme.colors.foregroundFaint,
  },
  submitText: {
    color: theme.colors.accentForeground,
    // Soft chrome: 12.5 meta.
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: theme.fontWeight.medium,
  },
  errorText: {
    color: theme.colors.destructive,
    fontSize: 12.5,
    lineHeight: 16,
    marginTop: 4,
  },
}));
