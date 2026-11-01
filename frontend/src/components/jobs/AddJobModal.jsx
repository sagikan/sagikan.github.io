import JobPostForm from "./JobPostForm";
import Modal from "../ui/Modal";

// Modal for adding a job by hand
function AddJobModal({ csrfToken, pastEntries, applications, onClose, onAdded, onUnauthorized }) {
  return (
    <Modal title="New Job Post" onClose={onClose}>
      <JobPostForm
        csrfToken={csrfToken}
        pastEntries={pastEntries}
        applications={applications}
        onAdded={onAdded}
        onUnauthorized={onUnauthorized}
      />
    </Modal>
  );
}

export default AddJobModal;
