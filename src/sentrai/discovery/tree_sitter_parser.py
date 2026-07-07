"""
Tree-sitter based semantic analysis for multi-language codebase discovery.
"""

from typing import Tuple, Set, List
import logging
from tree_sitter import Language, Parser, Query, QueryCursor

logger = logging.getLogger(__name__)

# Languages
try:
    import tree_sitter_python
    import tree_sitter_javascript
    import tree_sitter_typescript
    import tree_sitter_go
    
    PY_LANG = Language(tree_sitter_python.language())
    JS_LANG = Language(tree_sitter_javascript.language())
    TS_LANG = Language(tree_sitter_typescript.language_typescript())
    GO_LANG = Language(tree_sitter_go.language())
    
    PY_IMPORT_QUERY = Query(PY_LANG, """
        (import_statement name: (dotted_name) @import)
        (import_from_statement module_name: (dotted_name) @import_from)
    """)
    PY_CALL_QUERY = Query(PY_LANG, """
        (call 
            function: [
                (identifier) @func_name
                (attribute attribute: (identifier) @func_name)
            ]
            arguments: (argument_list
                (keyword_argument) @kw_arg
            )
        )
    """)
    
    JS_TS_IMPORT_QUERY = {
        lang: Query(lang, """
            (import_statement source: (string) @import_source)
            (call_expression
                function: (identifier) @func
                (#eq? @func "require")
                arguments: (arguments (string) @require_source)
            )
        """) for lang in [JS_LANG, TS_LANG]
    }
    
    JS_TS_CALL_QUERY = {
        lang: Query(lang, """
            (new_expression
                constructor: (identifier) @constructor
                arguments: (arguments
                    (object
                        (pair
                            key: [
                                (property_identifier) @prop_name
                                (string) @prop_name
                            ]
                            value: (string) @prop_value
                        )
                    )
                )
            )
        """) for lang in [JS_LANG, TS_LANG]
    }
    
    GO_IMPORT_QUERY = Query(GO_LANG, """
        (import_spec path: (interpreted_string_literal) @import_path)
    """)
    
    PY_PARSER = Parser(PY_LANG)
    JS_PARSER = Parser(JS_LANG)
    TS_PARSER = Parser(TS_LANG)
    GO_PARSER = Parser(GO_LANG)
    
    HAS_TREE_SITTER = True
except ImportError as e:
    logger.warning(f"Failed to load tree-sitter languages: {e}")
    HAS_TREE_SITTER = False


def scan_python(content: str) -> Tuple[Set[str], List[str]]:
    detected = set()
    gaps = []
    if not HAS_TREE_SITTER:
        return detected, gaps
        
    tree = PY_PARSER.parse(content.encode('utf-8'))
    
    for match in QueryCursor(PY_IMPORT_QUERY).matches(tree.root_node):
        for capture in ([n for nodes in match[1].values() for n in nodes] if isinstance(match[1], dict) else match[1]):
            name = capture.text.decode('utf-8')
            base_name = name.split('.')[0]
            detected.add(base_name)
            
    for match in QueryCursor(PY_CALL_QUERY).matches(tree.root_node):
        for capture in ([n for nodes in match[1].values() for n in nodes] if isinstance(match[1], dict) else match[1]):
            node_type = capture.type
            if node_type == 'identifier':
                func_name = capture.text.decode('utf-8')
                if func_name in ("OpenAI", "ChatOpenAI", "Anthropic", "GenerativeModel", "pipeline"):
                    detected.add("generative_api_call")
                    
            if node_type == 'keyword_argument':
                text = capture.text.decode('utf-8')
                if "api_key" in text and ("'" in text or '"' in text):
                    gaps.append("Vulnerability: Hardcoded api_key string literal passed in function call.")

    return detected, gaps


def scan_javascript(content: str) -> Tuple[Set[str], List[str]]:
    return _scan_js_ts(content, JS_LANG)


def scan_typescript(content: str) -> Tuple[Set[str], List[str]]:
    return _scan_js_ts(content, TS_LANG)


def _scan_js_ts(content: str, lang: Language) -> Tuple[Set[str], List[str]]:
    detected = set()
    gaps = []
    if not HAS_TREE_SITTER:
        return detected, gaps
        
    if lang == JS_LANG:
        tree = JS_PARSER.parse(content.encode('utf-8'))
    else:
        tree = TS_PARSER.parse(content.encode('utf-8'))
    
    import_query = JS_TS_IMPORT_QUERY[lang]
    for match in QueryCursor(import_query).matches(tree.root_node):
        for capture in ([n for nodes in match[1].values() for n in nodes] if isinstance(match[1], dict) else match[1]):
            val = capture.text.decode('utf-8').strip("'\"")
            if val and val != "require":
                base_lib = val.split('/')[-1] if val.startswith('@') else val.split('/')[0]
                detected.add(base_lib)
                
    call_query = JS_TS_CALL_QUERY[lang]
    for match in QueryCursor(call_query).matches(tree.root_node):
        for capture in ([n for nodes in match[1].values() for n in nodes] if isinstance(match[1], dict) else match[1]):
            text = capture.text.decode('utf-8')
            if "apiKey" in text and not "process.env" in text:
                gaps.append("Vulnerability: Hardcoded apiKey string literal passed in constructor call.")
                
    return detected, gaps


def scan_go(content: str) -> Tuple[Set[str], List[str]]:
    detected = set()
    gaps = []
    if not HAS_TREE_SITTER:
        return detected, gaps
        
    tree = GO_PARSER.parse(content.encode('utf-8'))
    
    for match in QueryCursor(GO_IMPORT_QUERY).matches(tree.root_node):
        for capture in ([n for nodes in match[1].values() for n in nodes] if isinstance(match[1], dict) else match[1]):
            val = capture.text.decode('utf-8').strip('"')
            if val:
                base_lib = val.split('/')[-1]
                detected.add(base_lib)
                
    return detected, gaps
