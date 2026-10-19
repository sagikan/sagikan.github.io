function hueOf(letter) {
  return Math.round(letter.codePointAt(0) * 137.508) % 360;
}

function CompanyAvatar({ company }) {
  const letter = company.trim()[0]?.toUpperCase() || "?";

  return (
    <span className="avatar avatar-initial" style={{ "--hue": hueOf(letter) }}>
      {letter}
    </span>
  );
}

export default CompanyAvatar;
