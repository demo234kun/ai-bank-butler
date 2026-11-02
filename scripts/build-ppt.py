#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成答辩 PPT：16:9 · 10 页 · 每页带演讲者备注。

    python scripts/build-ppt.py
输出：docs/ppt/AI银行管家-答辩.pptx
预览：powershell -File tools/export-ppt.ps1 / tools/export-ppt-pdf.ps1
口径：内容全部来自已实现功能与真实截图，数字可在仓库里复现。
"""
from __future__ import annotations

import io
import os

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.oxml.ns import qn
from pptx.util import Emu, Inches, Pt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, "docs", "assets")
SHOTS = os.path.join(ASSETS, "product-review")
OUT_DIR = os.path.join(ROOT, "docs", "ppt")
OUT_FILE = os.environ.get("PPT_OUT") or os.path.join(OUT_DIR, "AI银行管家-答辩.pptx")

W, H = 13.333, 7.5
MX = 0.62
CW = W - MX * 2
CT = 1.74
FT = 6.98
PHONE = 780 / 1688

FONT = "Microsoft YaHei"
INK = RGBColor(0x0A, 0x0F, 0x1C)
PANEL = RGBColor(0x14, 0x1C, 0x30)
PANEL_2 = RGBColor(0x1B, 0x25, 0x3D)
LINE = RGBColor(0x27, 0x33, 0x50)
TEXT = RGBColor(0xE9, 0xEE, 0xF8)
MUTED = RGBColor(0x93, 0xA1, 0xBD)
DIM = RGBColor(0x6C, 0x7A, 0x96)
ACCENT = RGBColor(0x5B, 0xA8, 0xFF)
GREEN = RGBColor(0x3E, 0xCF, 0x8E)
YELLOW = RGBColor(0xF5, 0xB6, 0x3B)
RED = RGBColor(0xF0, 0x61, 0x6D)
WHITE = RGBColor(0xFF, 0xFF, 0xFF)

TOTAL = 10
_page = {"n": 0}


# ---------------------------------------------------------------- 控件

def slide(prs):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = INK
    return s


def font(run, size, color=TEXT, bold=False, name=FONT, tracking=None):
    f = run.font
    f.size = Pt(size)
    f.bold = bold
    f.name = name
    f.color.rgb = color
    rPr = run._r.get_or_add_rPr()
    ea = rPr.find(qn("a:ea"))
    if ea is None:
        ea = rPr.makeelement(qn("a:ea"), {})
        rPr.append(ea)
    ea.set("typeface", name)
    if tracking:
        rPr.set("spc", str(int(tracking)))
    return run


def box(s, x, y, w, h, anchor=MSO_ANCHOR.TOP):
    tb = s.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = tb.text_frame
    tf.word_wrap = True
    tf.vertical_anchor = anchor
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    return tf


def para(tf, text, size=14, color=TEXT, bold=False, first=False, align=PP_ALIGN.LEFT,
         space_after=6, space_before=0, line=1.22, tracking=None):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.space_before = Pt(space_before)
    p.line_spacing = line
    r = p.add_run()
    r.text = text
    font(r, size, color, bold, tracking=tracking)
    return p


def rich(tf, segments, size=14, first=False, align=PP_ALIGN.LEFT, space_after=6, line=1.22):
    p = tf.paragraphs[0] if first else tf.add_paragraph()
    p.alignment = align
    p.space_after = Pt(space_after)
    p.line_spacing = line
    for text, color, bold in segments:
        r = p.add_run()
        r.text = text
        font(r, size, color, bold)
    return p


def shape(s, kind, x, y, w, h, fill=PANEL, line_color=None, line_w=0.75, radius=None):
    sp = s.shapes.add_shape(kind, Inches(x), Inches(y), Inches(w), Inches(h))
    sp.shadow.inherit = False
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line_color is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line_color
        sp.line.width = Pt(line_w)
    if radius is not None and kind == MSO_SHAPE.ROUNDED_RECTANGLE:
        try:
            sp.adjustments[0] = radius
        except Exception:
            pass
    tf = sp.text_frame
    tf.word_wrap = True
    tf.margin_left = tf.margin_right = Inches(0.14)
    tf.margin_top = tf.margin_bottom = Inches(0.07)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    return sp


def card(s, x, y, w, h, fill=PANEL, line_color=LINE, accent=None):
    sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=fill, line_color=line_color, radius=0.045)
    if accent:
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x + 0.2, y + 0.22, 0.055, 0.3, fill=accent, radius=0.5)
    return sp


def chip(s, x, y, w, text, size=11.5, fill=PANEL_2, color=TEXT, line_color=LINE, h=0.32):
    sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=fill, line_color=line_color, radius=0.5)
    para(sp.text_frame, text, size, color, False, first=True, space_after=0, align=PP_ALIGN.CENTER, line=1.0)
    return sp


def pill(s, x, y, w, text, color, size=11, h=0.26):
    sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=INK, line_color=color, radius=0.5)
    para(sp.text_frame, text, size, color, True, first=True, space_after=0, align=PP_ALIGN.CENTER, line=1.0)
    return sp


def arrow(s, x, y, w=0.26, h=0.16, color=ACCENT):
    return shape(s, MSO_SHAPE.RIGHT_ARROW, x, y, w, h, fill=color, line_color=None)


def connector(s, x1, y1, x2, y2, color=LINE, wpt=1.0):
    c = s.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(x1), Inches(y1), Inches(x2), Inches(y2))
    c.shadow.inherit = False
    c.line.color.rgb = color
    c.line.width = Pt(wpt)
    return c


def pic(s, path, x, y, h=None, w=None):
    if not os.path.exists(path):
        return None
    kw = {"height": Inches(h)} if h else {"width": Inches(w)}
    p = s.shapes.add_picture(path, Inches(x), Inches(y), **kw)
    p.line.color.rgb = LINE
    p.line.width = Pt(1.0)
    return p


def header(s, kicker, title, page_label=None, size=29):
    tf = box(s, MX, 0.42, CW, 0.26)
    para(tf, kicker, 11.5, ACCENT, True, first=True, space_after=0, tracking=220, line=1.0)
    tf = box(s, MX, 0.72, CW, 0.62)
    para(tf, title, size, TEXT, True, first=True, space_after=0, line=1.05)
    shape(s, MSO_SHAPE.RECTANGLE, MX, 1.46, 0.62, 0.035, fill=ACCENT)
    shape(s, MSO_SHAPE.RECTANGLE, MX + 0.62, 1.46, CW - 0.62, 0.035, fill=LINE)
    if page_label:
        tf = box(s, W - MX - 3.6, 1.40, 3.6, 0.24)
        para(tf, page_label, 10.5, DIM, False, first=True, space_after=0, align=PP_ALIGN.RIGHT, line=1.0)


def add_bullets(tf, items, size=13.5, gap=8, color=TEXT, dot=ACCENT, dot_size=None, first=None):
    if first is None:
        first = len(tf.paragraphs) == 1 and not tf.paragraphs[0].runs
    for it in items:
        if isinstance(it, tuple):
            lead, rest = it
            p = rich(tf, [(lead, dot or color, True), (rest, color, False)],
                     size=size, first=first, space_after=gap, line=1.24)
        else:
            p = para(tf, it, size, color, False, first=first, space_after=gap, line=1.24)
        first = False
        pPr = p._p.get_or_add_pPr()
        pPr.set("marL", "171450")
        pPr.set("indent", "-171450")
        clr = pPr.makeelement(qn("a:buClr"), {})
        clr.append(pPr.makeelement(qn("a:srgbClr"),
                                   {"val": "%02X%02X%02X" % (dot[0], dot[1], dot[2]) if dot else "93A1BD"}))
        pPr.append(clr)
        pPr.append(pPr.makeelement(qn("a:buSzPts"), {"val": str(int((dot_size or size + 3) * 100))}))
        pPr.append(pPr.makeelement(qn("a:buFont"), {"typeface": FONT}))
        pPr.append(pPr.makeelement(qn("a:buChar"), {"char": "·"}))
    return tf


def footer(s):
    _page["n"] += 1
    tf = box(s, MX, FT, CW * 0.6, 0.26)
    para(tf, "AI 银行管家 · 答辩", 10, DIM, False, first=True, space_after=0, line=1.0)
    tf = box(s, W - MX - 2.2, FT, 2.2, 0.26)
    para(tf, f"{_page['n']:02d} / {TOTAL}", 10, DIM, False, first=True, space_after=0,
         align=PP_ALIGN.RIGHT, line=1.0)


def notes(s, text):
    s.notes_slide.notes_text_frame.text = text


def band(s, x, y, w, h, lines, line_color=ACCENT):
    """lines: [(前缀, 前缀色, 正文, 字号), ...]"""
    sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=PANEL_2, line_color=line_color, radius=0.06)
    tf = sp.text_frame
    tf.margin_left = Inches(0.28)
    tf.margin_top = Inches(0.12)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    for i, (lead, lc, body, size) in enumerate(lines):
        rich(tf, [(lead, lc, True), (body, TEXT if i == 0 else MUTED, False)],
             size=size, first=i == 0, space_after=5 if i < len(lines) - 1 else 0, line=1.2)
    return sp


# ---------------------------------------------------------------- 10 页

def p01(prs):
    s = slide(prs)
    shape(s, MSO_SHAPE.RECTANGLE, 0, 0, W, 0.055, fill=ACCENT)
    tf = box(s, MX, 1.30, 7.2, 0.3)
    para(tf, "AI 智能体创新应用挑战赛 · 答辩汇报", 12.5, ACCENT, True, first=True, space_after=0,
         tracking=200, line=1.0)
    tf = box(s, MX, 1.80, 7.4, 1.0)
    para(tf, "AI 银行管家", 52, WHITE, True, first=True, space_after=0, line=1.0)
    tf = box(s, MX, 2.88, 7.4, 0.5)
    para(tf, "用户说一句，Agent 把业务办完", 23, TEXT, False, first=True, space_after=0, line=1.05)
    tf = box(s, MX, 3.46, 7.4, 0.4)
    para(tf, "可授权 · 可审计 · 可回退的银行级智能体", 15, MUTED, False, first=True, space_after=0, line=1.05)

    rows = [("六大场景", "转账 / 账单 / 理财 / 卡片 / 订阅 / 跨场景联动"),
            ("五档权限", "T0–T4，5 万元转人工审核，20 万元上限才拒绝"),
            ("四项安全", "防幻觉 · 防注入 · 哈希链审计 · 熔断沙箱"),
            ("真实执行", "计划任务到点扣款，语音与生物识别真实可用")]
    for i, (t, d) in enumerate(rows):
        tf = box(s, MX, 4.16 + i * 0.44, 7.2, 0.4)
        rich(tf, [(f"{i+1:02d}  ", ACCENT, True), (f"{t}　", TEXT, True), (d, MUTED, False)],
             size=12.5, first=True, space_after=0, line=1.0)

    tf = box(s, MX, 6.16, 7.2, 0.5)
    para(tf, "汇报人 ______ · 日期 ______ · 在线体验与仓库地址见末页", 10.5, DIM, False, first=True,
         space_after=0, line=1.1)

    p = pic(s, os.path.join(SHOTS, "pure-home.png"), 9.30, 1.10, h=5.5)
    if p:
        shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 9.16, 0.96, Emu(p.width) / 914400 + 0.28,
              Emu(p.height) / 914400 + 0.28, fill=None, line_color=LINE, line_w=1.2, radius=0.04)
    footer(s)
    notes(s, "0:00–0:40\n开场：手机银行办一件事要跳三层菜单，我们把它压成一句话。今天讲清楚两件事：它能办哪些业务，以及凭什么是安全的。")


def p02(prs):
    s = slide(prs)
    header(s, "01 问题与产品", "把权限、审计、回退做进执行骨架", page_label="对标：赛题背景 / 产品形态")

    card(s, MX, CT + 0.12, 5.35, 2.62, accent=RED)
    tf = box(s, MX + 0.44, CT + 0.34, 4.7, 2.2)
    para(tf, "银行 Agent 的四个信任缺口", 15, TEXT, True, first=True, space_after=13, line=1.05)
    add_bullets(tf, [("越权不可控", "　模型输出直接驱动操作，提示词即权限"),
                     ("幻觉出数字", "　余额、收益率由语言层生成"),
                     ("注入可诱导", "　一句绕过话术跳过确认"),
                     ("事后无留痕", "　无法还原谁批准了什么")],
                size=13.5, gap=12, color=MUTED, dot=RED)

    band(s, MX, 4.52, 5.35, 2.14, [
        ("我们的做法　", ACCENT, "权限判定、授权签发、审计留痕、补偿回退全部放在服务端执行层，模型只负责理解意图。", 13.5),
        ("　", ACCENT, "体验问题（入口深、术语多、无上下文）交给对话式入口；信任问题交给执行层。", 12),
        ("　", ACCENT, "/console 评委控制台与手机端读同一份服务端状态，链路当场可查。", 12),
    ])

    ah = 4.3
    pw = ah * PHONE
    shots = [("pure-chat.png", "对话内完成确认与强验证"),
             ("pure-profile.png", "账号 · 额度 · 测评 · 设备"),
             ("qa-notifications.png", "调度结果与提醒中心")]
    x = 6.30
    for f, cap in shots:
        pic(s, os.path.join(SHOTS, f), x, CT + 0.12, h=ah)
        tf = box(s, x, CT + 0.12 + ah + 0.06, pw, 0.3)
        para(tf, cap, 9.5, MUTED, False, first=True, space_after=0, align=PP_ALIGN.CENTER, line=1.05)
        x += pw + 0.22

    footer(s)
    notes(s, "0:40–1:40\n左边四条是银行敢不敢放 AI 动账户的真实原因，右边是可安装、可登录、多用户隔离的手机 PWA。\n"
             "记住一句话：提示词可以被注入，权限不能，所以权限放在服务端。")


def p03(prs):
    s = slide(prs)
    header(s, "02 场景覆盖", "六大场景全部落到一次真实操作", page_label="对标：赛题任务六大场景")

    rows = [("智能转账", "“给林晚转 520 元，备注爱你”", "同名先澄清 · 定时到点扣款 · 拆分 AA · 当日冲正", GREEN),
            ("账单分析", "“这个月花了多少？有异常吗”", "分类由流水推导 · 环比 · 重复扣费与异常识别", GREEN),
            ("理财操作", "“想放一万，推荐款稳健的”", "风险测评 → 适当性上限 → 对比 → 申购走红色", YELLOW),
            ("卡片管理", "“申请一张虚拟卡，额度 3000”", "额度总览 · 申请注销 · 冻结解挂（挂失为红色）", YELLOW),
            ("订阅 / 代扣", "“把健身会员的自动续费取消”", "识别订阅与涨价 · 续费提醒 · 取消可恢复", YELLOW),
            ("跨场景联动", "“我爱人下周生日，帮我提前安排”", "预算锁定 + 两笔订购 + 日程，一张确认单", ACCENT)]
    colw, rowh, gap = 4.03, 2.16, 0.21
    for i, (name, quote, detail, color) in enumerate(rows):
        cx = MX + (i % 3) * (colw + gap)
        cy = CT + 0.12 + (i // 3) * (rowh + gap)
        card(s, cx, cy, colw, rowh)
        pill(s, cx + 0.24, cy + 0.22, 1.05, f"0{i+1}", color, size=10, h=0.24)
        tf = box(s, cx + 0.24, cy + 0.58, colw - 0.48, 1.5)
        para(tf, name, 15.5, TEXT, True, first=True, space_after=8, line=1.05)
        para(tf, quote, 12, color, False, space_after=8, line=1.18)
        para(tf, detail, 10.8, MUTED, False, space_after=0, line=1.22)

    strip = [("风险测评", "决定可购产品上限"), ("交易详情", "可提交争议工单"),
             ("服务端调度", "到点真实执行"), ("账号体系", "验证 / 找回 / 踢设备")]
    sw = (CW - 3 * 0.14) / 4
    for i, (t, d) in enumerate(strip):
        sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, MX + i * (sw + 0.14), 6.24, sw, 0.48,
                   fill=PANEL, line_color=LINE, radius=0.14)
        tf = sp.text_frame
        tf.margin_left = Inches(0.16)
        rich(tf, [(t + "　", ACCENT, True), (d, MUTED, False)], size=10.5, first=True, space_after=0, line=1.0)

    footer(s)
    notes(s, "1:40–2:40\n前五个是单场景闭环，第六个把六个场景串成一次规划，这是 Agent 与语音助手的分界。\n"
             "底下一行是周边流程：测评决定能买什么、账单能提工单、计划任务真的会扣款、账号能注册找回密码踢设备。")


def p04(prs):
    s = slide(prs)
    header(s, "03 权限分级", "五档执行级别，大额交易也能办", page_label="对标：核心技术要求 · 权限分级")

    rows = [
        ("T0", "绿色", "只读查询、账单分析、持仓、订阅扫描", "自动执行", GREEN),
        ("T1", "黄色", "日累计 ≤1000 元转账、订阅取消、虚拟卡、冻结、预算锁定", "参数摘要确认", RGBColor(0x7A, 0x9B, 0x3B)),
        ("T2", "黄色 · 强确认", "风控 ≥35，或首次收款人且 >500 元", "摘要 + 手输收款人姓名", YELLOW),
        ("T3", "红色", "单笔 >1000 元、>5000 元双因子、理财申赎、挂失解挂、风控 ≥60", "摘要 + 复述 + 生物识别 / 短信", RED),
        ("T4", "红色 · 延迟放行", "单笔 >5 万元、风控 ≥85、命中风险名单", "人工审核队列，10 分钟内可撤销", RGBColor(0x7A, 0x2C, 0x4E)),
        ("拒绝", "—", "单笔 >20 万元或日累计 >50 万元", "拒绝并提示走柜面/提额", DIM),
    ]
    gf = s.shapes.add_table(len(rows) + 1, 4, Inches(MX), Inches(CT + 0.06), Inches(8.55), Inches(3.3))
    tbl = gf.table
    tbl.first_row = True
    tbl.horz_banding = False
    for i, wd in enumerate([0.75, 1.5, 4.1, 2.2]):
        tbl.columns[i].width = Inches(wd)
    tbl.rows[0].height = Inches(0.34)
    for r in range(1, len(rows) + 1):
        tbl.rows[r].height = Inches(0.48)

    for c, t in enumerate(["档位", "对应赛题", "触发条件", "执行要求"]):
        cell = tbl.cell(0, c)
        cell.fill.solid()
        cell.fill.fore_color.rgb = PANEL_2
        cell.margin_left = cell.margin_right = Inches(0.08)
        cell.vertical_anchor = MSO_ANCHOR.MIDDLE
        p = cell.text_frame.paragraphs[0]
        p.space_after = Pt(0)
        run = p.add_run()
        run.text = t
        font(run, 11.5, MUTED, True)

    for r, (tier, mapped, trigger, action, color) in enumerate(rows, start=1):
        for c, t in enumerate([tier, mapped, trigger, action]):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = PANEL if r % 2 else RGBColor(0x11, 0x18, 0x2A)
            cell.margin_left = cell.margin_right = Inches(0.08)
            cell.margin_top = cell.margin_bottom = Inches(0.04)
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf = cell.text_frame
            tf.word_wrap = True
            p = tf.paragraphs[0]
            p.space_after = Pt(0)
            p.line_spacing = 1.1
            run = p.add_run()
            run.text = t
            if c == 0:
                font(run, 12.5, color, True)
            elif c == 1:
                font(run, 10.5, color if color != DIM else MUTED, True)
            else:
                font(run, 9.8, TEXT if c == 2 else MUTED, False)

    tf = box(s, 9.32, CT + 0.12, 3.4, 1.9)
    para(tf, "档位 = max(静态档, 风控档)", 12.5, TEXT, True, first=True, space_after=8, line=1.15)
    add_bullets(tf, ["金额 + 操作类型 + 当日已用额度",
                     "风控智能体 0–100 分，只能升档",
                     "模型输出不参与判定"],
                size=10.8, gap=6, color=MUTED)
    para(tf, "十四类信号：金额占比、行为基线、收款人新异性、深夜、频次、拆分规避、会话风险、注入嫌疑、置信度、名单、诈骗话术、收款人改动、新设备、额度余量。",
         9.8, MUTED, space_before=6, space_after=0, line=1.2)

    band(s, MX, 5.32, CW, 0.96, [
        ("5 万元不再一刀切　", RED, "转人工审核并延迟到账，期内可撤销；审核通过后按 T3 执行，只有 20 万元产品上限才拒绝。", 11.5),
        ("双因子与差异声明　", DIM, "单笔 >5000 元双因子；密码修改未纳入 Agent 红色目录，U 盾未接入。", 10.5),
    ], line_color=RED)

    footer(s)
    notes(s, "2:40–3:40 五档是本次改版的核心：T0 自动、T1 摘要确认、T2 要求手输收款人姓名、T3 多因子、T4 人工审核延迟放行。5 万元不再禁止，只有超过 20 万产品上限才拒绝。档位取静态档与风控档的较大值，风控只能升档。被问到凭什么信这个分数：十四类信号全部来自账本与会话事实，分数与命中项随策略判定写入审计链，可回放。")



def p05(prs):
    s = slide(prs)
    header(s, "04 一次性授权", "确认单是哈希锁定的参数摘要", page_label="对标：多因子认证 + 操作确认")

    steps = [("摘要哈希绑定", "用户 + 会话 + run + 节点 + 全部参数"),
             ("展示与确认", "含手输收款人姓名（T2 起）"),
             ("签发一次性授权", "90 秒过期，用后即废"),
             ("执行前重校验", "参数被改或风险升级 → 作废重验")]
    x = MX
    wstep = 2.86
    for i, (t, d) in enumerate(steps):
        sp = card(s, x, CT + 0.14, wstep, 1.34)
        tf = sp.text_frame
        tf.vertical_anchor = MSO_ANCHOR.TOP
        tf.margin_top = Inches(0.16)
        tf.margin_left = Inches(0.2)
        rich(tf, [(f"{i+1}  ", ACCENT, True), (t, TEXT, True)], size=13.5, first=True, space_after=7, line=1.08)
        para(tf, d, 11, MUTED, False, space_after=0, line=1.2)
        if i < 3:
            arrow(s, x + wstep + 0.06, CT + 0.14 + 0.58)
        x += wstep + 0.38

    card(s, MX, 3.36, 6.2, 1.94, accent=ACCENT)
    tf = box(s, MX + 0.42, 3.56, 5.5, 1.6)
    para(tf, "摘要覆盖什么", 14.5, TEXT, True, first=True, space_after=9, line=1.05)
    add_bullets(tf, ["哈希绑定：用户、会话、run、节点、全部参数",
                     "人可读：收款人、金额、账户、备注、当日剩余额度",
                     "失效即重来：期间被篡改 → 旧授权作废并重新要求验证"],
                size=12, gap=7, color=MUTED)

    card(s, MX + 6.56, 3.36, 5.62, 1.94, accent=GREEN)
    tf = box(s, MX + 6.98, 3.56, 4.95, 1.6)
    para(tf, "红色操作可用三条通道", 14.5, TEXT, True, first=True, space_after=9, line=1.05)
    add_bullets(tf, [("本机生物识别", "　WebAuthn 平台认证器，服务端校验 origin、rpId、一次性挑战与签名计数器"),
                     ("签约活体人脸", "　HTTP Provider，未签约时退回演示通道并显式标注"),
                     ("短信验证码", "　服务端下发、一次性随机码，用后即删")],
                size=11.5, gap=6, color=MUTED, dot=GREEN)

    band(s, MX, 5.5, CW, 1.16, [
        ("批量确认逐个授权　", ACCENT, "跨场景联动的一张确认单覆盖三个操作，每个节点仍有独立 grant、独立 digest，执行前逐个校验。", 13),
        ("回退分两种　", GREEN, "可逆节点按逆序补偿（冲正、解冻、恢复订阅）；申购与挂失不可逆，界面显示“部分完成 · 转人工”。", 12),
    ])

    footer(s)
    notes(s, "3:40–4:40\n确认单是一份被哈希锁定的参数摘要，签发的授权 90 秒过期、用后即废；期间参数被改或额度被占导致升级，旧授权当场作废。\n"
             "生物识别走服务端验签；演示通道在界面上标注性质。")


def p06(prs):
    s = slide(prs)
    header(s, "05 安全机制", "四道防线，越往里越不依赖模型", page_label="对标：核心技术要求 · 安全机制")

    rows = [("① 幻觉防护", "事实锁定",
             "模型只输出受 JSON Schema 约束的意图与槽位，不生成执行计划、不产出金额、不写回执文案；账户、余额、收益率一律取自账本。渲染前数字守卫扫描输出中的金额与百分比，与账本不一致则整段拒绝下发。", ACCENT),
            ("② 注入防御", "三层递进",
             "输入侧规则打分（越权指令、绕过话术、系统提示探测）→ 模型侧嫌疑度升级 → 服务端策略、授权与工具白名单兜底。语言层被骗过时，工具目录里没有的路径依然执行不了。", YELLOW),
            ("③ 操作审计", "追加式哈希链",
             "userId 参与哈希，逐条记录意图解析、策略判定、授权签发、节点执行、补偿与人工介入，每 50 条 checkpoint；支持按用户过滤、按 run 回放，篡改副本链会被检出。", GREEN),
            ("④ 熔断与沙箱", "失败即关闭",
             "连续工具失败或连续注入命中即锁定会话，必须人工复核解锁，解锁动作本身入链。模型生成的统计代码在 worker + vm 内运行，先静态检查再执行，无文件与网络权限，带超时与内存上限，输入只来自当前用户的只读快照。", RED)]
    y = CT + 0.1
    for name, tag, detail, color in rows:
        card(s, MX, y, CW, 1.06)
        tf = box(s, MX + 0.28, y + 0.18, 2.5, 0.76)
        para(tf, name, 15, color, True, first=True, space_after=4, line=1.0)
        para(tf, tag, 11, MUTED, False, space_after=0, line=1.0)
        connector(s, MX + 2.95, y + 0.16, MX + 2.95, y + 0.9)
        tf = box(s, MX + 3.2, y + 0.14, CW - 3.5, 0.82)
        para(tf, detail, 11.8, TEXT, False, first=True, space_after=0, line=1.24)
        y += 1.18

    tf = box(s, MX, 6.52, CW, 0.28)
    rich(tf, [("现场可验证：", ACCENT, True),
              ("攻防实验室里摘要篡改、令牌重放、策略独立性三项均可当场发起，并看到拦截与审计留痕。", MUTED, False)],
         size=11.5, first=True, space_after=0, line=1.1)

    footer(s)
    notes(s, "4:40–5:40\n四道防线里最硬的是第四道：工具白名单在服务器，模型被说服也不会多转一分钱。\n"
             "审计链是逐条串联的哈希，改一条整链校验就报错；沙箱只给只读快照，断网也能跑完六个场景。")


def p07(prs):
    s = slide(prs)
    header(s, "06 语义理解与任务规划", "大模型理解 + 业务模板 + DAG", page_label="对标：核心技术要求 · 语义理解与任务规划")

    card(s, MX, CT + 0.12, 7.5, 3.34)
    tf = box(s, MX + 0.3, CT + 0.32, 6.9, 0.5)
    para(tf, "“我爱人下周生日，帮我提前安排”", 14.5, ACCENT, True, first=True, space_after=2, line=1.05)
    para(tf, "大模型解析意图与槽位 → 命中「生日联动」模板（18 个业务模板之一）→ 补齐日期与预算 → 生成可确认的 DAG", 10.8, MUTED, space_after=0, line=1.1)

    def node(x, y, w, h, title, sub, color):
        nn = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h, fill=PANEL_2, line_color=color, radius=0.08)
        tf = nn.text_frame
        tf.margin_left = tf.margin_right = Inches(0.08)
        tf.margin_top = tf.margin_bottom = Inches(0.04)
        para(tf, title, 11.5, TEXT, True, first=True, space_after=1, line=1.02)
        para(tf, sub, 9.2, MUTED, False, space_after=0, line=1.02)

    base = CT + 0.92
    node(MX + 0.32, base + 0.66, 1.5, 0.7, "解析日期", "意图 + 上下文", ACCENT)
    node(MX + 2.24, base + 0.66, 1.62, 0.7, "锁定活期预算", "1000 元 · 黄色", YELLOW)
    node(MX + 4.3, base + 0.16, 1.6, 0.7, "D-2 订购鲜花", "黄色 · 独立 grant", YELLOW)
    node(MX + 4.3, base + 1.16, 1.6, 0.7, "D-1 订购蛋糕", "黄色 · 独立 grant", YELLOW)
    node(MX + 6.14, base + 0.66, 1.2, 0.7, "写入日程", "提醒 + 审计", GREEN)
    for (x1, y1, x2, y2) in [(1.82, base + 1.01, 2.24, base + 1.01),
                             (3.86, base + 0.9, 4.3, base + 0.51),
                             (3.86, base + 1.12, 4.3, base + 1.51),
                             (5.9, base + 0.51, 6.14, base + 0.9),
                             (5.9, base + 1.51, 6.14, base + 1.12)]:
        connector(s, MX + x1, y1, MX + x2, y2, color=DIM, wpt=1.25)

    tf = box(s, MX + 0.32, CT + 2.86, 6.9, 0.5)
    rich(tf, [("一张确认单覆盖三个黄色操作：", TEXT, True), ("一次批准、分别授权、分别留痕。", MUTED, False)],
         size=11.5, first=True, space_after=3, line=1.2)
    para(tf, "预算到期由服务端调度器自动释放，订购到点由调度器真实下单。", 11.5, MUTED, space_after=0, line=1.2)

    tf = box(s, 8.5, CT + 0.16, 4.2, 3.3)
    para(tf, "规划的四个约束", 14, TEXT, True, first=True, space_after=12, line=1.05)
    add_bullets(tf, [("模型只给意图与槽位", "　每条消息都调用大模型解析，规则只做预抽取与故障兜底；执行路径从 18 个业务模板中选择，模型不生成调用链"),
                     ("槽位缺失先澄清", "　金额、收款人、产品为空时不默认填值，不带着空收款人执行资金操作"),
                     ("上下文可接住省略", "　“再转 200”“就那个”“换成 1000”由上下文栈解析"),
                     ("执行可控可恢复", "　待确认可取消、执行中可中断、人工可接管；确认即断流，按 seq 续传")],
                size=11.2, gap=9, color=MUTED)

    band(s, MX, 5.34, CW, 1.32, [
        ("回退分两种　", ACCENT, "转账冲正、解冻、订阅恢复走补偿；申购与挂失不可逆，只标记转人工，界面显示“部分完成”。", 13),
        ("确认时主动断流　", TEXT, "SSE 不挂起等待人工，run.paused 后关闭连接，确认后用序号续传；刷新页面从快照恢复同一张确认单。", 12),
    ])

    footer(s)
    notes(s, "5:40–6:40\n规划器只接受意图编号，这是模型权限的硬天花板。\n"
             "生日这个例子体现 DAG 的价值：三个黄色操作合并成一张确认单，每个节点仍有独立授权和独立留痕。")


def p08(prs):
    s = slide(prs)
    header(s, "07 现场演示", "同一份服务端状态，当场可查", page_label="本页切换实机演示")

    demo = [("1", "黄色 · 小额转账", "“给林晚转 520 元，备注爱你”",
             "控制台看 NLU 槽位 → DAG 三节点 → 策略判黄 → 摘要哈希 → 确认后审计链增长", YELLOW),
            ("2", "红色 · 当日累计越线", "“再给林晚转 6000 元”",
             "当日累计已过 1000，档位升红；走本机生物识别签名（服务端验签）或双因子", RED),
            ("3", "注入 · 熔断 · 接管", "绕过确认 / 系统提示探测话术",
             "INJECTION_BLOCK 入链；第二条命中即锁会话，人工复核解锁且解锁动作本身入链", ACCENT)]
    y = CT + 0.14
    for idx, title, input_, see, color in demo:
        card(s, MX, y, 7.0, 1.12)
        pill(s, MX + 0.22, y + 0.18, 0.34, idx, color, size=12, h=0.28)
        tf = box(s, MX + 0.68, y + 0.15, 6.1, 0.86)
        rich(tf, [(title, color, True), ("　" + input_, TEXT, False)], size=12.5, first=True, space_after=6, line=1.16)
        para(tf, see, 10.8, MUTED, False, space_after=0, line=1.2)
        y += 1.26

    cw = 4.8
    p = pic(s, os.path.join(SHOTS, "qa-console-1440.png"), 7.88, CT + 0.14, w=cw)
    if p:
        tf = box(s, 7.88, CT + 0.14 + Emu(p.height) / 914400 + 0.06, cw, 0.4)
        para(tf, "评委控制台：意图解析、任务图、策略判定、授权摘要、审计链、攻防实验室同屏", 10, DIM, False,
             first=True, space_after=0, line=1.1)

    band(s, MX, 5.6, CW, 1.08, [
        ("三笔共用同一份当日额度台账　", ACCENT, "第 2 笔变红，正是第 1 笔造成的。", 12.5),
        ("兜底　", YELLOW, "链路不稳时切“离线兜底”，规则引擎跑完六个场景；模型不可用时控制台标注 offline 来源；确认单 90 秒过期，取消后重发。", 11.5),
    ])

    footer(s)
    notes(s, "6:40–7:40\n现场跑这三段；网络不稳就切离线兜底或播预录片段。红色强验证是全场的信任高点，放慢速度，把摘要、通道、剩余额度念出来。\n"
             "被问“这是模拟吗”：默认使用合成数据与演示通道，工具层已抽成 BankingGateway，配 BANKING_MODE=http 后全部资金操作走签名银行核心，失败显式报错、不回退仿真。")


def p09(prs):
    s = slide(prs)
    header(s, "08 验证与接入", "每条主张都能复现，接真实核心只换配置", page_label="对标：项目规范 · 可交付性")

    metrics = [("105", "项单元测试", "策略 / NLU / 规划 / 审计 / 账本 / 集成 / 风险 / 争议"),
               ("236", "条审计事件", "全链路冒烟一次跑完的真实留痕"),
               ("33", "项浏览器回归", "真实 Chrome：确认、强验、工单、语音、响应式"),
               ("291", "个第三方依赖", "许可逐条清点（MIT / ISC / Apache / BSD 等）")]
    x = MX
    for big, t, d in metrics:
        card(s, x, CT + 0.1, 2.95, 1.62)
        tf = box(s, x + 0.22, CT + 0.26, 2.5, 1.4)
        para(tf, big, 27, ACCENT, True, first=True, space_after=2, line=1.0)
        para(tf, t, 12.5, TEXT, True, space_after=5, line=1.05)
        para(tf, d, 10, MUTED, False, space_after=0, line=1.18)
        x += 2.95 + 0.155

    tf = box(s, MX, 3.6, CW, 0.3)
    rich(tf, [("两种运行形态：", TEXT, True),
              ("纯产品版与带标注版只差一个构建期开关，行为与数据来源完全一致。", MUTED, False)],
         size=12.5, first=True, space_after=0, line=1.2)

    base = 4.06
    node = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, MX, base, 2.2, 1.0, fill=PANEL_2, line_color=ACCENT, radius=0.07)
    para(node.text_frame, "BankingGateway 抽象", 12.5, TEXT, True, first=True, space_after=2,
         align=PP_ALIGN.CENTER, line=1.05)
    para(node.text_frame, "快照读取 + 操作写入", 10, MUTED, False, align=PP_ALIGN.CENTER, space_after=0, line=1.05)
    for i, (label, detail, color) in enumerate([
        ("仿真核心", "本地确定性数据，开箱即演示", DIM),
        ("HTTP 签名网关", "HMAC-SHA256（方法+路径+时间戳+nonce+报文哈希）· 写操作幂等键 · 超时重试 · 客户端熔断 · Schema 校验", GREEN),
    ]):
        xx = MX + 2.86
        nn = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, xx, base + i * 1.14, 5.0, 0.94, fill=PANEL, line_color=color, radius=0.06)
        tf = nn.text_frame
        tf.margin_left = Inches(0.2)
        para(tf, label, 12.5, TEXT if i else MUTED, True, first=True, space_after=2, line=1.05)
        para(tf, detail, 9.8, MUTED, False, space_after=0, line=1.16)
        connector(s, MX + 2.2, base + 0.5, xx, base + 0.47 + i * 1.14, color=DIM, wpt=1.25)

    sp = shape(s, MSO_SHAPE.ROUNDED_RECTANGLE, 11.2, base, 1.6, 2.08, fill=RGBColor(0x14, 0x22, 0x1B),
               line_color=GREEN, radius=0.06)
    tf = sp.text_frame
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    para(tf, "失败即关闭", 12.5, GREEN, True, first=True, space_after=5, align=PP_ALIGN.CENTER, line=1.1)
    para(tf, "真实模式同步失败直接返回不可用，绝不回退仿真数据；接入配置不完整时服务启动即失败。",
         9.6, MUTED, False, align=PP_ALIGN.CENTER, space_after=0, line=1.18)

    tf = box(s, MX, 6.34, CW, 0.42)
    para(tf, "对外契约齐备：OpenAPI 接口定义、字段与错误码、幂等语义、联调桩；行方按契约映射到自有核心即可，两种模式共用同一套工具、策略与审计代码。",
         11.5, MUTED, False, first=True, space_after=0, line=1.2)

    footer(s)
    notes(s, "7:40–8:40\n左边四个数字都能在仓库里跑出来：npm test、npm run smoke:full、node tools/qa-product.mjs。\n"
             "右边的关键在切换的只是网关实现，权限、授权、审计代码一行不动，接真实系统不会引入第二套安全逻辑。")


def p10(prs):
    s = slide(prs)
    header(s, "09 边界与收尾", "已具备的能力，和还没做的事", page_label="自评口径：开发期自查")

    have = ["六大场景闭环", "三级权限判定", "一次性授权摘要", "多因子强验证", "追加式哈希链审计",
            "异常熔断与人工接管", "受限代码沙箱", "适当性拦截申购", "争议工单受理", "服务端真实调度",
            "可安装 PWA + 多用户隔离", "评委控制台"]
    card(s, MX, CT + 0.12, 6.3, 2.62, line_color=GREEN)
    tf = box(s, MX + 0.28, CT + 0.32, 5.75, 2.3)
    para(tf, "已具备（今天可演示）", 14.5, GREEN, True, first=True, space_after=10, line=1.05)
    for i in range(0, len(have), 2):
        seg = [(have[i], TEXT, False)]
        if i + 1 < len(have):
            seg.append(("　·　", DIM, False))
            seg.append((have[i + 1], TEXT, False))
        rich(tf, seg, size=11.5, space_after=8, line=1.15)

    gaps = [("行方凭据", "真实账户读写、短信模板、活体人脸、语音转写：交付契约与可切换实现，未做行方联调"),
            ("账号与风控", "无 U 盾、无 KYC 与账号注销；风控覆盖金额阈值与频次限流，缺商户/设备/地区/黑名单维度"),
            ("渠道", "IM 渠道未接入；对话接口与渠道无关，接入只需增加消息适配层"),
            ("生产化", "存储为单机 JSON、会话在内存；争议只到受理与状态回显；未做渗透测试与第三方安全评估")]
    card(s, MX + 6.62, CT + 0.12, 5.5, 2.62, line_color=RED)
    tf = box(s, MX + 6.9, CT + 0.32, 4.95, 2.3)
    para(tf, "未做（生产化阶段）", 14.5, RED, True, first=True, space_after=10, line=1.05)
    add_bullets(tf, [f"{t}：{d}" for t, d in gaps], size=10.8, gap=8, color=MUTED, dot=RED)

    band(s, MX, 4.5, CW, 0.92, [
        ("我们交付判断，也交付边界。　", ACCENT, "演示通道在界面上如实标注性质；凭据类能力交付契约、可切换实现与失败即关闭的行为。", 13),
    ])

    url = os.environ.get("PPT_DEMO_URL", "").strip()
    if not url:
        cand = os.path.join(os.environ.get("TEMP", ""), "bank-public-url.txt")
        if os.path.exists(cand):
            url = io.open(cand, encoding="utf-8").read().strip()
    links = [("源代码仓库", "GitHub 地址待填写（仓库尚未初始化）"),
             ("在线体验", url or "公网演示为临时隧道，提交前需固定域名托管"),
             ("演示视频", "≤5 分钟，分镜已就绪，待录制")]
    x = MX
    for t, d in links:
        card(s, x, 5.58, 3.95, 0.94)
        tf = box(s, x + 0.24, 5.72, 3.5, 0.72)
        para(tf, t, 12.5, TEXT, True, first=True, space_after=4, line=1.05)
        para(tf, d, 9.8 if len(d) > 40 else 10.8, MUTED, False, space_after=0, line=1.16)
        x += 3.95 + 0.13

    tf = box(s, MX, 6.56, CW, 0.3)
    para(tf, "让 Agent 能办事不难，难的是敢让它办事：每一分钱都能说清是谁、在什么授权下、经哪条链路动的。",
         12, ACCENT, True, first=True, space_after=0, line=1.1)

    footer(s)
    notes(s, "8:40–10:00\n把没做的写在答辩里，是因为在银行场景里“声称已做”本身就是风险；这些边界同时写在安全自评报告的 19 条已知风险清单里。\n"
             "收尾一句：权限在服务器、授权是一次性的、每一步都留了痕，所以银行敢让它动账户。")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    prs = Presentation()
    prs.slide_width = Inches(W)
    prs.slide_height = Inches(H)
    for fn in [p01, p02, p03, p04, p05, p06, p07, p08, p09, p10]:
        fn(prs)
    prs.core_properties.title = "AI 银行管家 · 答辩"
    prs.core_properties.subject = "AI 智能体创新应用挑战赛"
    prs.core_properties.author = "AI 银行管家"
    prs.core_properties.comments = "生成脚本 scripts/build-ppt.py；大纲 docs/ppt-outline.md；截图与架构图来自 docs/assets"
    prs.save(OUT_FILE)
    print(f"已生成 {OUT_FILE}：{TOTAL} 页，{round(os.path.getsize(OUT_FILE)/1024)} KB")


if __name__ == "__main__":
    main()
