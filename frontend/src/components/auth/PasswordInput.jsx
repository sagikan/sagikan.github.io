// Password input
function PasswordInput({ value, onChange, ...props }) {
  return (
    <input
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      required
      {...props}
    />
  );
}

export default PasswordInput;
