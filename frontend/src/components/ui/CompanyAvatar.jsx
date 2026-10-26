// Picks a stable hue for a letter
function hueOf(letter) {
  return Math.round(letter.codePointAt(0) * 137.508) % 360;
}

// Shows a company's first letter in a colored circle
function CompanyAvatar({ company }) {
  const letter = company.trim()[0]?.toUpperCase() || "?";

  return (
    <span className="avatar avatar-initial" style={{ "--hue": hueOf(letter) }}>
      {letter}
    </span>
  );
}

export default CompanyAvatar;
