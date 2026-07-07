import io
from reportlab.lib.pagesizes import letter
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from sentrai.domain.model_inventory import AIModelEntry
from sentrai.compliance.frameworks_validator import validate_nist_rmf, validate_eu_ai_act, validate_iso_42001

def generate_compliance_pdf(entry: AIModelEntry) -> bytes:
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=letter,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40
    )
    
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Heading1'],
        fontName='Helvetica-Bold',
        fontSize=24,
        textColor=colors.HexColor('#1e293b'),
        spaceAfter=15
    )
    section_style = ParagraphStyle(
        'DocSection',
        parent=styles['Heading2'],
        fontName='Helvetica-Bold',
        fontSize=14,
        textColor=colors.HexColor('#0f172a'),
        spaceBefore=12,
        spaceAfter=6
    )
    body_style = ParagraphStyle(
        'DocBody',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=10,
        textColor=colors.HexColor('#334155'),
        spaceAfter=8
    )
    
    story = []
    
    story.append(Paragraph(f"SentrAI Compliance Report", title_style))
    story.append(Paragraph(f"Model ID: {entry.model_id}", body_style))
    story.append(Paragraph(f"Model Name: {entry.name}", body_style))
    story.append(Spacer(1, 15))
    
    nist = validate_nist_rmf(entry)
    eu = validate_eu_ai_act(entry)
    iso = validate_iso_42001(entry)
    
    story.append(Paragraph("🇺🇸 NIST AI RMF 1.0 Compliance Checklist", section_style))
    data = [["Control", "Name", "Status", "Evidence"]]
    for check in nist.checks:
        status_text = "PASS" if check.passed else "FAIL"
        data.append([check.control_code, check.name, status_text, check.evidence])
        
    t = Table(data, colWidths=[80, 150, 60, 240])
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#0f172a')),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('BOTTOMPADDING', (0,0), (-1,0), 6),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
    ]))
    story.append(t)
    story.append(Spacer(1, 15))
    
    story.append(Paragraph("🇪🇺 EU AI Act Compliance Checklist", section_style))
    story.append(Paragraph(f"Assessed Risk Tier: {eu.risk_tier}", body_style))
    data_eu = [["Article", "Requirement", "Status", "Evidence"]]
    for check in eu.checks:
        status_text = "PASS" if check.passed else "FAIL"
        data_eu.append([check.control_code, check.name, status_text, check.evidence])
        
    t_eu = Table(data_eu, colWidths=[80, 150, 60, 240])
    t_eu.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#0f172a')),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('BOTTOMPADDING', (0,0), (-1,0), 6),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
    ]))
    story.append(t_eu)
    story.append(Spacer(1, 15))

    story.append(Paragraph("🌐 ISO 42001 Compliance Checklist", section_style))
    data_iso = [["Clause", "Requirement", "Status", "Evidence"]]
    for check in iso.checks:
        status_text = "PASS" if check.passed else "FAIL"
        data_iso.append([check.control_code, check.name, status_text, check.evidence])
        
    t_iso = Table(data_iso, colWidths=[80, 150, 60, 240])
    t_iso.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#f1f5f9')),
        ('TEXTCOLOR', (0,0), (-1,0), colors.HexColor('#0f172a')),
        ('ALIGN', (0,0), (-1,-1), 'LEFT'),
        ('BOTTOMPADDING', (0,0), (-1,0), 6),
        ('GRID', (0,0), (-1,-1), 0.5, colors.HexColor('#e2e8f0')),
        ('FONTNAME', (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE', (0,0), (-1,-1), 8),
    ]))
    story.append(t_iso)
    
    doc.build(story)
    return buffer.getvalue()
