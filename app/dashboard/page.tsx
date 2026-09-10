"use client";

import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { sendEmail, getEmailStats } from "@/app/utils/email-service";
import {
  saveCompanies,
  loadCompanies,
  Company,
} from "@/app/utils/storage-service";
import { APPLICATION_TEMPLATE } from "@/app/utils/email-templates";

export default function Dashboard() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSending, setIsSending] = useState(false);
 
  const [sendStatus, setSendStatus] = useState<{
    success: boolean;
    message: string;
    show: boolean;
  }>({
    success: false,
    message: "",
    show: false,
  });
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_isStatsLoading, setIsStatsLoading] = useState(false);

  // Company template manager state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [newCompany, setNewCompany] = useState({
    name: "",
    url: "",
    email: "",
    managerName: "",
  });
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(
    null
  );
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);

  // Generate a preview of the email with company data inserted
  const generateEmailFromTemplate = (company: typeof newCompany) => {
    const template = APPLICATION_TEMPLATE.replace(
      /\[Company Name\]/g,
      company.name
    )
      .replace(/\[Hiring Manager's Name\]/g, company.managerName)
      .replace(/\[Candidate First Name\]/g, company.managerName);

    // Extract subject from template
    const subject = template.split("\n")[0].replace("Subject: ", "");
    const body = template.split("\n").slice(1).join("\n");

    return { subject, body };
  };

  // Add a new company to the list
  const handleAddCompany = () => {
    if (!newCompany.managerName.trim() || !newCompany.email.trim()) {
      setSendStatus({
        success: false,
        message: "Candidate first name and email are required",
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        5000
      );
      return;
    }

    const id = Date.now().toString();
    const newCompanyItem: Company = {
      id,
      ...newCompany,
      status: "pending",
    };

    setCompanies((prev) => [...prev, newCompanyItem]);

    // Reset form
    setNewCompany({
      name: "",
      url: "",
      email: "",
      managerName: "",
    });

    setSendStatus({
      success: true,
      message: `Added ${newCompany.managerName} to your list`,
      show: true,
    });
    setTimeout(() => setSendStatus((prev) => ({ ...prev, show: false })), 5000);
  };

  

  // Send email to selected company
  const handleSendToCompany = async (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    if (!company) return;

    setIsSending(true);
    setSelectedCompanyId(companyId);

    try {
      const { subject, body } = generateEmailFromTemplate(company);

      // Format the email body with HTML before sending
      const formattedBody = formatMessageForPreview(body, true);

      const result = await sendEmail({
        to: company.email,
        subject,
        message: formattedBody,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to send email");
      }

      // Update company status
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === companyId ? { ...c, status: "sent" as const } : c
        )
      );

      setSendStatus({
        success: true,
        message: `Email sent to ${company.managerName}!`,
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        5000
      );

      // Refresh stats after sending
      fetchEmailStats();
    } catch (error) {
      console.error("Error sending email:", error);

      // Update company status
      setCompanies((prev) =>
        prev.map((c) =>
          c.id === companyId ? { ...c, status: "failed" as const } : c
        )
      );

      setSendStatus({
        success: false,
        message: `Failed to send email to ${company.managerName}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        8000
      );
    } finally {
      setIsSending(false);
      setSelectedCompanyId(null);
    }
  };

  // Preview email for a company
  const handlePreviewEmail = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    if (!company) return;

    const { subject, body } = generateEmailFromTemplate(company);
    setSubject(subject);
    setMessage(body);
    setTo(company.email);
    setShowTemplatePreview(true);
  };

  // Remove a company from the list
  const handleRemoveCompany = (companyId: string) => {
    setCompanies((prev) => prev.filter((c) => c.id !== companyId));
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/signin");
    }

    // Fetch email stats when session is available
    if (session?.accessToken) {
      fetchEmailStats();
    }
  }, [status, router, session]);

  // Load companies from storage on component mount
  useEffect(() => {
    const storedCompanies = loadCompanies();
    if (storedCompanies.length > 0) {
      setCompanies(storedCompanies);
    }
  }, []);

  // Save companies to storage whenever they change
  useEffect(() => {
    saveCompanies(companies);
  }, [companies]);

  const fetchEmailStats = async () => {
    if (!session?.accessToken) return;

    try {
      setIsStatsLoading(true);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const emailStats = await getEmailStats();
     console.log(emailStats);
    } catch (error) {
      console.error("Error fetching email stats:", error);
    } finally {
      setIsStatsLoading(false);
    }
  };

  const handleSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!to || !subject || !message) {
      setSendStatus({
        success: false,
        message: "Please fill all the fields",
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        5000
      );
      return;
    }

    setIsSending(true);
    setSendStatus({
      success: false,
      message: "",
      show: false,
    });

    try {
      // Format the message with HTML before sending
      const formattedMessage = formatMessageForPreview(message, true);

      const result = await sendEmail({
        to,
        subject,
        message: formattedMessage,
      });

      if (!result.success) {
        throw new Error(result.error || "Failed to send email");
      }

      // Reset form after sending
      setTo("");
      setSubject("");
      setMessage("");
      setSendStatus({
        success: true,
        message: "Email sent successfully!",
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        5000
      );

      // Refresh stats after sending
      fetchEmailStats();
    } catch (error) {
      console.error("Error sending email:", error);
      setSendStatus({
        success: false,
        message: `Failed to send email: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        show: true,
      });
      setTimeout(
        () => setSendStatus((prev) => ({ ...prev, show: false })),
        8000
      );
    } finally {
      setIsSending(false);
    }
  };


  // Format the message with proper HTML styling for preview and sending
  const formatMessageForPreview = (msg: string, forSending = false) => {
    if (!msg) return "";

    // First wrap paragraphs properly
    let formattedContent =
      "<p>" +
      msg
        .split(/\n{2,}/)
        .join("</p><p>")
        .replace(/\n/g, "<br>") +
      "</p>";

    // Then format special sections
    formattedContent = formattedContent
      .replace(
        /<p>Key Projects:/g,
        '<p><strong style="display: block; font-size: 16px; margin-top: 16px; margin-bottom: 10px; color: #333333;">Key Projects:</strong>'
      )
      .replace(
        /• /g,
        '<span style="color: #2563eb; display: inline-block; width: 12px; font-weight: bold; margin-right: 4px;">•</span>'
      )
      .replace(
        /Best regards,/g,
        '<strong style="display: block; margin-top: 20px; margin-bottom: 6px; color: #333333;">Best regards,</strong>'
      )
      .replace(
        /(LinkedIn:) (https:\/\/[^\s<]+)/g,
        '<span style="color: #333333; font-weight: 500;">$1</span> <a href="$2" style="color: #2563eb; text-decoration: none;" target="_blank">$2</a>'
      )
      .replace(
        /(GitHub:) (https:\/\/[^\s<]+)/g,
        '<span style="color: #333333; font-weight: 500;">$1</span> <a href="$2" style="color: #2563eb; text-decoration: none;" target="_blank">$2</a>'
      )
      .replace(
        /(Resume:) (https:\/\/[^\s<]+)/g,
        '<span style="color: #333333; font-weight: 500;">$1</span> <a href="$2" style="color: #2563eb; text-decoration: none;" target="_blank">$2</a>'
      )
      .replace(
        /(Assignment URL:) (https:\/\/[^\s<]+)/g,
        '<span style="color: #333333; font-weight: 500;">$1</span> <a href="$2" style="color: #2563eb; text-decoration: none;" target="_blank">$2</a>'
      );

    // For preview in the UI, return just the formatted content
    if (!forSending) {
      return formattedContent;
    }

    // For sending emails, wrap with full HTML structure
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Application Email</title>
    <style>
        body {
            font-family: Arial, Helvetica, sans-serif;
            line-height: 1.6;
            color: #333333;
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
        }
        p {
            margin-bottom: 16px;
            margin-top: 0;
        }
        a {
            color: #2563eb;
            text-decoration: none;
        }
        a:hover {
            text-decoration: underline;
        }
        .project-bullet {
            color: #2563eb;
            display: inline-block;
            width: 12px;
            margin-right: 4px;
            font-weight: bold;
        }
        .project-title {
            font-weight: bold;
            margin-top: 20px;
            margin-bottom: 10px;
        }
        .signature {
            margin-top: 30px;
        }
        .contact-info {
            margin-top: 10px;
        }
    </style>
</head>
<body>
    <div class="email-content">
        ${formattedContent}
    </div>
</body>
</html>`;
  };

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="mb-4 h-12 w-12 animate-spin rounded-full border-t-4 border-blue-600 border-opacity-50"></div>
          <p className="text-lg font-medium text-gray-600">
            Loading your dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return null; // Will redirect via useEffect
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="border-b border-accent/20 bg-background/50 backdrop-blur-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 justify-between">
            <div className="flex">
              <div className="flex flex-shrink-0 items-center">
                <h1 className="text-xl font-bold text-primary">
                  Email Dashboard
                </h1>
              </div>
            </div>
            <div className="flex items-center">
              <button
                onClick={() => signOut()}
                className="cursor-pointer rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        

          {/* Company List */}
          <div className="col-span-1 lg:col-span-2">
            <div className="rounded-lg border border-accent/20 bg-background/50 backdrop-blur-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-foreground">
                  People
                </h2>
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {companies.length} {companies.length === 1 ? 'Candidate' : 'Candidates'}
                </span>
              </div>
              <div className="space-y-4">
                {companies.map((company) => (
                  <div
                    key={company.id}
                    className="flex items-center justify-between rounded-lg border border-accent/20 bg-background/50 p-4"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-foreground">
                          {company.managerName}
                        </h3>
                        {company.status === "sent" && (
                          <span className="rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                            Sent
                          </span>
                        )}
                        {company.status === "failed" && (
                          <span className="rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
                            Failed
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-foreground/80">
                        {company.email}
                      </p>
                      {company.name && (
                        <p className="text-xs text-foreground/60">
                          Company: {company.name}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handlePreviewEmail(company.id)}
                        className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
                      >
                        Preview 
                      </button>
                      <button
                        onClick={() => handleSendToCompany(company.id)}
                        disabled={isSending && selectedCompanyId === company.id || company.status === "sent"}
                        className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-semibold shadow-sm ${
                          company.status === "sent" 
                            ? "bg-green-500 text-white cursor-not-allowed opacity-70" 
                            : "bg-primary text-white hover:bg-primary-hover disabled:opacity-50"
                        }`}
                      >
                        {isSending && selectedCompanyId === company.id
                          ? "Sending..."
                          : company.status === "sent"
                          ? "Sent ✓"
                          : "Send"}
                      </button>
                      <button
                        onClick={() => handleRemoveCompany(company.id)}
                        className="cursor-pointer rounded-md bg-background px-3 py-1.5 text-sm font-semibold text-foreground shadow-sm hover:bg-accent/10"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Add Candidate Form - Sticky Right Column */}
          <div className="col-span-1 sticky top-4 h-[calc(100vh-2rem)] overflow-y-auto">
            <div className="rounded-lg border border-accent/20 bg-background/50 backdrop-blur-sm p-6">
              <h2 className="text-lg font-semibold text-foreground mb-4">
                Add Candidate
              </h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleAddCompany();
                }}
                className="space-y-4"
              >
                <div>
                  <label
                    htmlFor="name"
                    className="block text-sm font-medium text-foreground/80"
                  >
                    Company Name (Optional)
                  </label>
                  <input
                    type="text"
                    id="name"
                    value={newCompany.name}
                    onChange={(e) =>
                      setNewCompany((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-accent/20 bg-background px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label
                    htmlFor="email"
                    className="block text-sm font-medium text-foreground/80"
                  >
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={newCompany.email}
                    onChange={(e) =>
                      setNewCompany((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-accent/20 bg-background px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                </div>
                <div>
                  <label
                    htmlFor="managerName"
                    className="block text-sm font-medium text-foreground/80"
                  >
                    Candidate First Name
                  </label>
                  <input
                    type="text"
                    id="managerName"
                    value={newCompany.managerName}
                    onChange={(e) =>
                      setNewCompany((prev) => ({
                        ...prev,
                        managerName: e.target.value,
                      }))
                    }
                    className="mt-1 block w-full rounded-md border border-accent/20 bg-background px-3 py-2 text-foreground shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    required
                  />
                </div>
                <button
                  type="submit"
                  className="cursor-pointer w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
                >
                  Add Candidate
                </button>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* Status Message */}
      {sendStatus.show && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-background p-4 shadow-lg border border-accent/20">
          <p
            className={`text-sm font-medium ${
              sendStatus.success ? "text-primary" : "text-red-500"
            }`}
          >
            {sendStatus.message}
          </p>
        </div>
      )}

      {/* Email Preview Modal */}
      {showTemplatePreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg bg-background p-6 shadow-xl">
            <button
              onClick={() => setShowTemplatePreview(false)}
              className="absolute right-4 top-4 rounded-full p-1 text-foreground/60 hover:bg-accent/10 hover:text-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            
            <h2 className="mb-6 text-xl font-bold text-foreground">Email Preview</h2>
            
            <div className="mb-4">
              <p className="mb-1 text-sm font-medium text-foreground/80">To:</p>
              <p className="text-foreground">{to}</p>
            </div>
            
            <div className="mb-4">
              <p className="mb-1 text-sm font-medium text-foreground/80">Subject:</p>
              <p className="text-foreground">{subject}</p>
            </div>
            
            <div className="rounded-lg border border-accent/20 p-4">
              <p className="mb-1 text-sm font-medium text-foreground/80">Message:</p>
              <div 
                className="prose prose-sm max-w-none text-foreground"
                dangerouslySetInnerHTML={{ __html: formatMessageForPreview(message) }}
              />
            </div>
            
            <div className="mt-6 flex justify-end space-x-4">
              <button
                onClick={() => setShowTemplatePreview(false)}
                className="rounded-md bg-background px-4 py-2 text-sm font-semibold text-foreground shadow-sm hover:bg-accent/10"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setShowTemplatePreview(false);
                  handleSendEmail({ preventDefault: () => {} } as React.FormEvent);
                }}
                className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
              >
                Send Email
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
