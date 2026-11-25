import { Fragment, useId, useLayoutEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { VariableIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent } from "@/components/ui/popover";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  completedPortAlias,
  editPortText,
  portText,
  servicePortToken,
  textEdit,
  variableOffer,
} from "./command-variable-model";

type TextControl = HTMLInputElement | HTMLTextAreaElement;
type TextSelection = { start: number; end: number };

function selection(field: TextControl): TextSelection {
  return { start: field.selectionStart ?? 0, end: field.selectionEnd ?? 0 };
}

export function CommandVariableText({
  view,
  name,
}: {
  view: ReturnType<typeof portText>;
  name: string;
}) {
  let from = 0;
  return (
    <>
      {view.tokens.map(({ start, end, offset }) => {
        const prefix = view.text.slice(from, start);
        from = end;
        return (
          <Fragment key={offset}>
            {prefix}
            <span className="command-variable-chip" title={name}>
              {view.text.slice(start, end)}
            </span>
          </Fragment>
        );
      })}
      {view.text.slice(from)}
    </>
  );
}

export function CommandVariableField({
  id,
  label,
  description,
  value,
  format,
  port,
  active,
  multiline = false,
  required,
  disabled,
  onChange,
}: {
  id?: string;
  label: string;
  description?: string;
  value: string;
  format?: (value: string) => string;
  port: number | null | undefined;
  active: boolean;
  multiline?: boolean;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string, insertedVariable: boolean) => void;
}) {
  const { t } = useTranslation("commands");
  const fieldId = useId();
  const listId = fieldId + "-variables";
  const name = t("servicePort");
  const portLabel = port ? String(port) : name;
  const editedValue = useRef<string | undefined>(undefined);
  const view = portText(
    value === editedValue.current ? value : (format?.(value) ?? value),
    active ? portLabel : undefined,
  );
  const control = useRef<TextControl>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const before = useRef<TextSelection | undefined>(undefined);
  const contextSelection = useRef<TextSelection>({ start: 0, end: 0 });
  const nextCaret = useRef<number | null>(null);
  const [offer, setOffer] = useState<TextSelection | null>(null);
  const [composing, setComposing] = useState(false);
  const [composedText, setComposedText] = useState("");
  const undo = useRef<{ raw: string; text: string }[]>([]);

  const syncScroll = () => {
    if (!control.current || !mirror.current) return;
    mirror.current.scrollLeft = control.current.scrollLeft;
    mirror.current.scrollTop = control.current.scrollTop;
  };
  useLayoutEffect(() => {
    const field = control.current;
    if (!field) return;
    const capture = () => {
      before.current = selection(field);
    };
    field.addEventListener("beforeinput", capture);
    return () => field.removeEventListener("beforeinput", capture);
  }, [multiline]);
  useLayoutEffect(() => {
    if (nextCaret.current !== null) {
      control.current?.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
    syncScroll();
  });

  const apply = (range: TextSelection, insert: string, isVariable = false) => {
    const raw = editPortText(view, range, insert);
    const limit = multiline ? 65536 : 4096;
    if (raw.length > limit && raw.length > value.length) {
      nextCaret.current = null;
      return;
    }
    const containing = view.tokens.find(
      (token) => range.start > token.start && range.start < token.end,
    );
    nextCaret.current =
      (containing?.start ?? range.start) +
      portText(insert, isVariable ? portLabel : undefined).text.length;
    if (raw !== view.raw) {
      undo.current = [
        ...undo.current.slice(-31),
        { raw: value, text: view.text },
      ];
      editedValue.current = raw;
      onChange(raw, isVariable);
    } else {
      control.current?.setSelectionRange(nextCaret.current, nextCaret.current);
      nextCaret.current = null;
    }
  };

  const insertVariable = (range: TextSelection) => {
    setOffer(null);
    control.current?.focus();
    apply(range, servicePortToken, true);
  };

  const readChange = (event: ChangeEvent<TextControl>) => {
    const field = event.currentTarget;
    const input = event.nativeEvent as InputEvent;
    if (composing || input.isComposing) {
      setComposedText(field.value);
      return;
    }
    const cursor = selection(field).end;
    if (
      input.inputType === "historyUndo" ||
      input.inputType === "historyRedo"
    ) {
      const prior = [...undo.current]
        .reverse()
        .find((entry) => entry.text === field.value);
      if (prior) {
        undo.current = [
          ...undo.current.slice(-31),
          { raw: value, text: view.text },
        ];
        onChange(prior.raw, false);
        before.current = undefined;
        setOffer(null);
        return;
      }
    }
    const edit = textEdit(view.text, field.value, cursor, before.current);
    before.current = undefined;
    const alias = edit.inserted.endsWith("}")
      ? completedPortAlias(field.value, cursor)
      : null;
    if (alias !== null) {
      const prefix = field.value.slice(edit.start, alias);
      apply(
        { start: Math.min(edit.start, alias), end: edit.end },
        prefix + servicePortToken,
        true,
      );
      setOffer(null);
      return;
    }
    apply(edit, edit.inserted);
    setOffer(
      offer || edit.inserted.includes("$")
        ? variableOffer(field.value, cursor)
        : null,
    );
  };

  const keyDown = (event: KeyboardEvent<TextControl>) => {
    if (event.nativeEvent.isComposing) return;
    if (
      offer &&
      ["Enter", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Enter") insertVariable(offer);
      if (event.key === "Escape") setOffer(null);
      return;
    }
    const range = selection(event.currentTarget);
    const token = view.tokens.find(
      ({ start, end }) =>
        range.start === range.end &&
        ((event.key === "Backspace" &&
          range.start > start &&
          range.start <= end) ||
          (event.key === "Delete" &&
            range.start >= start &&
            range.start < end)),
    );
    if (token && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      setOffer(null);
      apply(token, "");
    }
  };

  const decorate = view.tokens.length > 0 && !composing;
  const common = {
    id: id ?? fieldId,
    value: composing ? composedText : view.text,
    disabled,
    required,
    spellCheck: false,
    autoCapitalize: "off",
    autoComplete: "off",
    "aria-label": label,
    "aria-describedby": description,
    "aria-autocomplete": "list" as const,
    "aria-haspopup": "listbox" as const,
    "aria-controls": offer ? listId : undefined,
    "aria-activedescendant": offer ? listId + "-port" : undefined,
    onChange: readChange,
    onKeyDown: keyDown,
    onBlur: () => setOffer(null),
    onScroll: syncScroll,
    onCompositionStart: (event: React.CompositionEvent<TextControl>) => {
      before.current = selection(event.currentTarget);
      setOffer(null);
      setComposedText(event.currentTarget.value);
      setComposing(true);
    },
    onCompositionEnd: (event: React.CompositionEvent<TextControl>) => {
      const field = event.currentTarget;
      const edit = textEdit(
        view.text,
        field.value,
        selection(field).end,
        before.current,
      );
      before.current = undefined;
      setComposing(false);
      apply(edit, edit.inserted);
    },
    onSelect: (event: React.SyntheticEvent<TextControl>) => {
      const range = selection(event.currentTarget);
      if (offer && (range.start !== offer.end || range.end !== offer.end))
        setOffer(null);
    },
  };
  return (
    <ContextMenu
      disabled={disabled}
      onOpenChange={(open) => {
        if (!open || !control.current) return;
        contextSelection.current = selection(control.current);
        setOffer(null);
      }}
    >
      <ContextMenuTrigger
        className="command-variable-field"
        data-selectable="true"
        data-decorated={decorate ? "" : undefined}
        data-multiline={multiline ? "" : undefined}
        ref={anchor}
      >
        {decorate && (
          <div
            ref={mirror}
            aria-hidden="true"
            className="command-variable-mirror"
          >
            <CommandVariableText view={view} name={name} />
            {multiline && "\u200b"}
          </div>
        )}
        {multiline ? (
          <textarea
            {...common}
            ref={(element) => {
              control.current = element;
            }}
            className="preset-textarea command-variable-control"
            rows={4}
            maxLength={65536}
          />
        ) : (
          <Input
            {...common}
            ref={(element) => {
              control.current = element;
            }}
            className="command-variable-control"
            role="combobox"
            aria-expanded={!!offer}
            maxLength={4096}
          />
        )}
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={control}>
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <VariableIcon aria-hidden="true" />
            {t("insertVariable")}
          </ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem
              onClick={() => insertVariable(contextSelection.current)}
            >
              {name}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
      <Popover
        modal={false}
        open={!!offer && !disabled}
        onOpenChange={(open) => {
          if (!open) setOffer(null);
        }}
      >
        <PopoverContent
          anchor={anchor}
          align="start"
          initialFocus={false}
          finalFocus={false}
          role="presentation"
          className="command-variable-options"
        >
          <div id={listId} role="listbox" aria-label={t("insertVariable")}>
            <button
              id={listId + "-port"}
              type="button"
              tabIndex={-1}
              role="option"
              aria-selected="true"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => offer && insertVariable(offer)}
            >
              <VariableIcon size={15} aria-hidden="true" />
              <span>{name}</span>
              {!!port && <span className="command-variable-chip">{port}</span>}
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </ContextMenu>
  );
}
