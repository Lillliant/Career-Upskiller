import React from 'react';

const headingStyles = {
  1: { fontSize: '20px', fontWeight: 'bold', margin: '14px 0 8px 0', color: 'var(--color-text-main)' },
  2: { fontSize: '18px', fontWeight: 'bold', margin: '12px 0 6px 0', color: 'var(--color-text-main)' },
  3: { fontSize: '16px', fontWeight: 'bold', margin: '10px 0 6px 0', color: 'var(--color-text-main)' },
  4: { fontSize: '14px', fontWeight: 'bold', margin: '8px 0 4px 0', color: 'var(--color-text-main)' },
  5: { fontSize: '13px', fontWeight: 'bold', margin: '6px 0 4px 0', color: 'var(--color-text-main)' },
  6: { fontSize: '12px', fontWeight: 'bold', margin: '6px 0 4px 0', color: 'var(--color-text-main)' },
};

const codeStyle = {
  fontFamily: 'monospace',
  backgroundColor: 'rgba(255, 255, 255, 0.1)',
  padding: '2px 4px',
  borderRadius: '3px',
  fontSize: '90%',
  border: '1px solid var(--border-card)',
  color: 'var(--color-text-main)',
};

function renderInline(text) {
  const regex = /(\*\*|__|\*|_|`)/g;
  const parts = text.split(regex);

  if (parts.length === 1) return text;

  const result = [];
  const stack = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;

    if (part === '**' || part === '__') {
      if (stack.length > 0 && stack[stack.length - 1] === 'bold') {
        stack.pop();
      } else {
        stack.push('bold');
      }
    } else if (part === '*' || part === '_') {
      if (stack.length > 0 && stack[stack.length - 1] === 'italic') {
        stack.pop();
      } else {
        stack.push('italic');
      }
    } else if (part === '`') {
      if (stack.length > 0 && stack[stack.length - 1] === 'code') {
        stack.pop();
      } else {
        stack.push('code');
      }
    } else {
      let element = part;
      for (let j = stack.length - 1; j >= 0; j--) {
        const style = stack[j];
        if (style === 'bold') {
          element = <strong key={`b-${i}`}>{element}</strong>;
        } else if (style === 'italic') {
          element = <em key={`i-${i}`}>{element}</em>;
        } else if (style === 'code') {
          element = <code key={`c-${i}`} style={codeStyle}>{element}</code>;
        }
      }
      result.push(element);
    }
  }

  return result;
}

export function MarkdownRenderer({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const elements = [];
  let currentList = [];
  let currentParagraph = [];
  let currentCodeBlock = null;
  let blockKey = 0;

  const flushList = () => {
    if (currentList.length > 0) {
      elements.push(
        <ul key={`list-${blockKey++}`} style={{ margin: '8px 0', paddingLeft: '20px', listStyleType: 'disc' }}>
          {currentList.map((item, idx) => (
            <li key={idx} style={{ marginBottom: '4px', fontSize: '13px', lineHeight: '1.4', color: 'var(--color-text-main)' }}>
              {renderInline(item)}
            </li>
          ))}
        </ul>
      );
      currentList = [];
    }
  };

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      elements.push(
        <p key={`p-${blockKey++}`} style={{ margin: '8px 0', lineHeight: '1.4', fontSize: '13px', color: 'var(--color-text-main)' }}>
          {currentParagraph.map((line, idx) => (
            <React.Fragment key={idx}>
              {renderInline(line)}
              {idx < currentParagraph.length - 1 && <br />}
            </React.Fragment>
          ))}
        </p>
      );
      currentParagraph = [];
    }
  };

  const flushCodeBlock = () => {
    if (currentCodeBlock !== null) {
      elements.push(
        <pre
          key={`code-${blockKey++}`}
          style={{
            fontFamily: 'monospace',
            backgroundColor: 'rgba(0, 0, 0, 0.25)',
            border: '1px solid var(--border-card)',
            borderRadius: '6px',
            padding: '10px',
            fontSize: '12px',
            overflowX: 'auto',
            margin: '8px 0',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            color: 'var(--color-text-main)',
          }}
        >
          {currentCodeBlock.join('\n')}
        </pre>
      );
      currentCodeBlock = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim().startsWith('```')) {
      if (currentCodeBlock !== null) {
        flushCodeBlock();
      } else {
        flushList();
        flushParagraph();
        currentCodeBlock = [];
      }
      continue;
    }

    if (currentCodeBlock !== null) {
      currentCodeBlock.push(line);
      continue;
    }

    const trimmed = line.trim();

    if (trimmed === '') {
      flushList();
      flushParagraph();
      continue;
    }

    if (trimmed.startsWith('#')) {
      flushList();
      flushParagraph();
      const match = trimmed.match(/^(#{1,6})\s+(.*)$/);
      if (match) {
        const level = match[1].length;
        const headerText = match[2];
        const HeadingTag = `h${level}`;
        elements.push(
          <HeadingTag key={`h-${blockKey++}`} style={headingStyles[level]}>
            {renderInline(headerText)}
          </HeadingTag>
        );
      } else {
        currentParagraph.push(line);
      }
      continue;
    }

    const listMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listMatch) {
      flushParagraph();
      currentList.push(listMatch[1]);
      continue;
    }

    const oListMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (oListMatch) {
      flushList();
      flushParagraph();
      elements.push(
        <div key={`ol-${blockKey++}`} style={{ display: 'flex', gap: '6px', fontSize: '13px', margin: '6px 0', paddingLeft: '12px', lineHeight: '1.4', color: 'var(--color-text-main)' }}>
          <span style={{ fontWeight: '600' }}>{oListMatch[1]}.</span>
          <span>{renderInline(oListMatch[2])}</span>
        </div>
      );
      continue;
    }

    flushList();
    currentParagraph.push(line);
  }

  flushList();
  flushParagraph();
  flushCodeBlock();

  return <div className="markdown-content">{elements}</div>;
}
