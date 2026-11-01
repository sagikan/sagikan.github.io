import { formatDate, jobDay } from "../../lib/api";
import Alert from "../ui/Alert";

// Warns that an application for the same position and company already exists
function DuplicateWarning({ duplicate }) {
  if (!duplicate) {
    return null;
  }

  return (
    <Alert type="warning">
      You already applied to this position at this company on {formatDate(jobDay(duplicate))}.
    </Alert>
  );
}

export default DuplicateWarning;
