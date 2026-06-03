interface UpdateBannerProps {
  onUpdate: () => void;
}

export function UpdateBanner({ onUpdate }: UpdateBannerProps) {
  return (
    <div style={{
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      background: "#f59e0b",
      color: "#1c1917",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: "12px",
      padding: "10px 16px",
      fontSize: "14px",
      fontWeight: 500,
    }}>
      <span>A new version of Rainbow Categories is available.</span>
      <button
        onClick={onUpdate}
        style={{
          background: "#1c1917",
          color: "#fef9c3",
          border: "none",
          borderRadius: "6px",
          padding: "4px 12px",
          cursor: "pointer",
          fontWeight: 600,
          fontSize: "13px",
        }}
      >
        Update now
      </button>
    </div>
  );
}
