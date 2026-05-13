import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { customEmojiUrl, customEmojiReference } from "@/lib/customEmoji";

const BUCKET = "custom-emoji";
const NAME_REGEX = /^[a-z0-9_-]+$/;

interface StoredFile {
  name: string;
}

export function CustomEmojiManager() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [nameInput, setNameInput] = useState("");

  const loadFiles = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.storage.from(BUCKET).list("", {
      limit: 200,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      toast.error(`Failed to load emoji list: ${error.message}`);
      setFiles([]);
    } else {
      setFiles((data ?? []).filter((f) => f.name.toLowerCase().endsWith(".png")));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleCopy = useCallback(async (filename: string) => {
    const name = filename.replace(/\.png$/i, "");
    const ref = customEmojiReference(name);
    try {
      await navigator.clipboard.writeText(ref);
      toast.success(`Copied ${ref}`);
    } catch {
      toast.error("Copy failed");
    }
  }, []);

  const handleDelete = useCallback(async (filename: string) => {
    if (!confirm(`Delete ${filename}? This cannot be undone.`)) return;
    const { error } = await supabase.storage.from(BUCKET).remove([filename]);
    if (error) {
      toast.error(`Delete failed: ${error.message}`);
      return;
    }
    toast.success(`Deleted ${filename}`);
    void loadFiles();
  }, [loadFiles]);

  const handleUpload = useCallback(async () => {
    if (!selectedFile) {
      toast.error("Choose a PNG file first");
      return;
    }
    // Strip .png if user pasted it, then lowercase
    const cleanName = nameInput.trim().toLowerCase().replace(/\.png$/i, "");
    if (!cleanName) {
      toast.error("Enter a name");
      return;
    }
    if (!NAME_REGEX.test(cleanName)) {
      toast.error("Name must be lowercase letters, numbers, _ or - only (no spaces)");
      return;
    }
    if (selectedFile.type !== "image/png" && !selectedFile.name.toLowerCase().endsWith(".png")) {
      toast.error("File must be a PNG");
      return;
    }

    setUploading(true);
    const { error } = await supabase.storage.from(BUCKET).upload(
      `${cleanName}.png`,
      selectedFile,
      { upsert: false, contentType: "image/png" },
    );
    setUploading(false);

    if (error) {
      toast.error(`Upload failed: ${error.message}`);
      return;
    }
    toast.success(`Uploaded ${cleanName}.png — reference as img:${cleanName}`);
    setSelectedFile(null);
    setNameInput("");
    // Reset the file input
    const fileInput = document.getElementById("custom-emoji-file") as HTMLInputElement | null;
    if (fileInput) fileInput.value = "";
    void loadFiles();
  }, [selectedFile, nameInput, loadFiles]);

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Custom Emoji</h2>
      <p className="text-sm text-muted-foreground">
        Upload PNGs to use as image tiles. Reference them in puzzles with{" "}
        <code className="text-xs bg-secondary px-1 py-0.5 rounded">img:name</code>.
      </p>

      {/* Upload form */}
      <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
        <div className="space-y-1">
          <Label htmlFor="custom-emoji-file">PNG file</Label>
          <Input
            id="custom-emoji-file"
            type="file"
            accept="image/png,.png"
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="custom-emoji-name">Name (lowercase, no spaces)</Label>
          <Input
            id="custom-emoji-name"
            type="text"
            placeholder="e.g. submarine"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
        </div>
        <Button onClick={handleUpload} disabled={uploading || !selectedFile || !nameInput.trim()}>
          <Upload className="w-4 h-4 mr-1" /> {uploading ? "Uploading…" : "Upload"}
        </Button>
      </div>

      {/* File list */}
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No custom emoji uploaded yet.</p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {files.map((f) => {
            const name = f.name.replace(/\.png$/i, "");
            return (
              <div key={f.name} className="border border-border rounded-lg p-3 bg-card flex flex-col items-center gap-2">
                <img
                  src={customEmojiUrl(name)}
                  alt={name}
                  className="h-16 w-16 object-contain"
                  draggable={false}
                />
                <div className="text-xs font-mono text-muted-foreground truncate w-full text-center" title={f.name}>
                  {f.name}
                </div>
                <div className="flex gap-1 w-full">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleCopy(f.name)}
                  >
                    <Copy className="w-3 h-3 mr-1" /> Copy
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => handleDelete(f.name)}
                    aria-label={`Delete ${f.name}`}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
