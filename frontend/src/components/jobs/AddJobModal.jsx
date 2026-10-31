import JobPostForm from "./JobPostForm";
import Modal from "../ui/Modal";

// Modal for adding a job by hand
function AddJobModal({ csrfToken, pastEntries, onClose, onAdded, onUnauthorized }) {
  return (
    <Modal title="New Job Post" onClose={onClose}>
      <JobPostForm
        csrfToken={csrfToken}
        pastEntries={pastEntries}
        onAdded={onAdded}
        onUnauthorized={onUnauthorized}
      />
    </Modal>
  );
}

export default AddJobModal;
