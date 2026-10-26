// Lists the password rules and whether each is met
export function passwordRules(password, email) {
  const emailName = email.trim().toLowerCase().split("@")[0];

  return [
    {
      label: "12–72 characters",
      met: password.length >= 12 && new TextEncoder().encode(password).length <= 72
    },
    { label: "An uppercase letter", met: /[A-Z]/.test(password) },
    { label: "A lowercase letter", met: /[a-z]/.test(password) },
    { label: "A number", met: /[0-9]/.test(password) },
    { label: "A symbol (e.g. ! @ # $)", met: /[^A-Za-z0-9]/.test(password) },
    {
      label: "No email handle",
      met: password.length > 0 && !(emailName.length >= 3 && password.toLowerCase().includes(emailName))
    }
  ];
}
