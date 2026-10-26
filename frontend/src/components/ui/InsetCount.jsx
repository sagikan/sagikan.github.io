import CharCount from "./CharCount";

// Shows a field's character count inside it on the right, for fields without a label row
function InsetCount({ value, max, multiline = false, children }) {
  return (
    <div className={`inset-count${multiline ? " inset-count-multiline" : ""}`}>
      {children}
      <span className="inset-count-slot">
        <CharCount value={value} max={max} />
      </span>
    </div>
  );
}

export default InsetCount;
