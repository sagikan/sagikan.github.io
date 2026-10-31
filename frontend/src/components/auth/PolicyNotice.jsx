import { policyDate } from "../../utils/policy/policy";
import Modal from "../ui/Modal";

// Pop-up that tells a signed-in user the privacy policy was updated
function PolicyNotice({ onReview, onClose }) {
  return (
    <Modal title="Privacy Policy updated" onClose={onClose}>
      <p>We updated our Privacy Policy on {policyDate()}. Please take a moment to review what changed.</p>
      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose}>Continue</button>
        <button type="button" className="btn btn-primary" onClick={onReview}>Review policy</button>
      </div>
    </Modal>
  );
}

export default PolicyNotice;
