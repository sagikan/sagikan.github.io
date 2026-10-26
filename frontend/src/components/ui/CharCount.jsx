// Shows how much of a limit is used: a text's characters, or a given count
function CharCount({ value = "", count = value.length, max }) {
  return (
    <small className={`char-count${count >= max ? " char-count-full" : ""}`} aria-hidden="true">
      {count.toLocaleString("en-US")}/{max.toLocaleString("en-US")}
    </small>
  );
}

export default CharCount;
