import React, { useEffect, useRef, useState } from "react";
import { addressBorough, street } from "./opportunityBoard";
import { BOROUGH_CHOICES, PHONE_FIELD, cardEditDraft, collectCardEdits } from "./opportunityEdits";

export default function OpportunityEditor({ card, phoneOnly, onSave, onClose }) {
  const dialog = useRef(null);
  const form = useRef(null);
  const inFlight = useRef(false);
  const [draft, setDraft] = useState(() => cardEditDraft(card.values));
  const [reset, setReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState("");
  useEffect(() => {
    const el = dialog.current;
    el.showModal();
    el.querySelector(phoneOnly ? '[name="phone"]' : '[name="address"]')?.focus({ preventScroll: true });
    return () => el.close();
  }, [phoneOnly]);
  const groups = phoneOnly ? [["", [PHONE_FIELD]]] : card.groups;
  const hasEdits = phoneOnly ? Object.hasOwn(card.edits, "phone") : Object.keys(card.edits).length > 0;
  const title = phoneOnly ? (card.phone ? "Edit phone" : "Add phone") : "Edit card";

  const change = (key, value) => {
    setDraft((previous) => {
      const next = { ...previous, [key]: value };
      if (key === "address" || key.endsWith(":address")) {
        const borough = addressBorough(value);
        if (borough && borough !== addressBorough(previous[key])) next[key.replace(/address$/, "borough")] = borough;
      }
      return next;
    });
    if (Object.keys(errors).length) setErrors({});
    setFailure("");
  };
  const close = () => { if (!inFlight.current) onClose(); };
  const submit = async (event) => {
    event.preventDefault();
    if (inFlight.current) return;
    const { changes, errors: invalid } = collectCardEdits(card, draft, reset, phoneOnly);
    setErrors(invalid);
    setFailure("");
    const first = Object.keys(invalid)[0];
    if (first) {
      const input = form.current.elements.namedItem(first);
      const details = input?.closest("details");
      if (details) details.open = true;
      input?.focus();
      return;
    }
    if (!Object.keys(changes).length) return onClose();
    inFlight.current = true;
    setBusy(true);
    try { await onSave(changes); }
    catch (e) {
      setFailure(e.code === "CARD_CONFLICT" ? e.message : "Couldn't confirm the save. Your draft is still here; try Save again.");
      inFlight.current = false;
      setBusy(false);
    }
  };

  const field = ([key, label, type]) => {
    const id = `opCardEdit-${key}`;
    const props = { id, name: key, value: draft[key] ?? "", onChange: (e) => change(key, e.target.value),
      "aria-invalid": errors[key] ? true : undefined, "aria-describedby": errors[key] ? `${id}-error` : undefined };
    const width = key === "address" || key.endsWith(":address") ? " opEditWide" : ["name", "email", "phone"].includes(key) ? " opEditMobileWide" : "";
    return <div className={"opEditField" + width} key={key}>
      <label htmlFor={id}>{label}</label>
      {type === "borough" ? <select {...props}><option value="">Other / unspecified</option>{BOROUGH_CHOICES.map((b) => <option key={b}>{b}</option>)}</select>
        : type === "shape" ? <select {...props}><option value="">Not specified</option><option value="yes">Irregular</option><option value="no">Not marked irregular</option></select>
        : <input {...props} autoComplete="off" type={type === "tel" || type === "email" ? type : "text"}
            inputMode={type === "number" ? "decimal" : type === "whole" ? "numeric" : undefined}
            maxLength={type === "tel" ? 48 : 240} />}
      {errors[key] && <small id={`${id}-error`} className="opEditError">{errors[key]}</small>}
    </div>;
  };
  return (
    <dialog className={`opEditDialog${phoneOnly ? " opPhoneDialog" : ""}`} ref={dialog} aria-labelledby="opEditHeading"
      onCancel={(event) => { event.preventDefault(); close(); }}>
      <form className="opEditForm" noValidate ref={form} onSubmit={submit}>
        <header className="opEditHead">
          <h2 id="opEditHeading">{title}</h2>
          <p>{street(card.values.address) || "Opportunity"}</p>
        </header>
        <div className="opEditBody">
          <p className="opEditHint">{phoneOnly ? "For this card only. Leave it blank to remove the number. Saving won’t log a call."
            : "Changes are private to your board. Edits aren’t verified; original parcel research stays in Details. Notes and call history stay as they are."}</p>
          <fieldset disabled={busy}>
            {groups.map(([group, fields], index) => index === 0
              ? <div className="opEditGrid" key={group}>{fields.map(field)}</div>
              : <details className="opEditGroup" key={group}><summary>{group}</summary><div className="opEditGrid">{fields.map(field)}</div></details>)}
            <div className="opEditUtilities">
              {phoneOnly && draft.phone && <button className="opTxt" type="button" onClick={() => change("phone", "")}>Clear number</button>}
              {hasEdits && <button className="opTxt" type="button" onClick={() => {
                setDraft(cardEditDraft(card.baseline)); setReset(true); setErrors({}); setFailure("");
              }}>{phoneOnly ? "Restore original number" : "Restore original values"}</button>}
              {reset && <small>Review the original values, then save to restore them.</small>}
            </div>
          </fieldset>
        </div>
        <footer className="opEditFoot">
          {(failure || Object.keys(errors).length > 0) && <p className="opEditError" role="alert">{failure || "Check the highlighted fields."}</p>}
          <div className="opEditActs">
            <button type="button" className="ghost" onClick={close} disabled={busy}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : phoneOnly ? "Save phone" : "Save changes"}</button>
            <span className="opSR" role="status">{busy ? "Saving changes" : ""}</span>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
