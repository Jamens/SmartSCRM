package com.smartscrm.server.web;

import com.smartscrm.server.common.ApiResponse;
import com.smartscrm.server.common.BizException;
import com.smartscrm.server.entity.MaterialGroup;
import com.smartscrm.server.security.AuthPrincipal;
import com.smartscrm.server.service.MediaStorageService;
import com.smartscrm.server.service.MaterialService;
import com.smartscrm.server.web.dto.MaterialGroupRequest;
import com.smartscrm.server.web.dto.MaterialRequest;
import com.smartscrm.server.web.vo.MaterialGroupVO;
import com.smartscrm.server.web.vo.MaterialMediaVO;
import com.smartscrm.server.web.vo.MaterialVO;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.springframework.http.MediaType;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api")
public class MaterialController {

    private final MaterialService service;
    private final MediaStorageService mediaStorage;

    public MaterialController(MaterialService service, MediaStorageService mediaStorage) {
        this.service = service;
        this.mediaStorage = mediaStorage;
    }

    @GetMapping("/material-groups")
    @PreAuthorize("hasAuthority('material:read')")
    public ApiResponse<List<MaterialGroupVO>> listGroups(@AuthenticationPrincipal AuthPrincipal principal) {
        return ApiResponse.ok(service.listGroups(principal.tenantId()));
    }

    @PostMapping("/material-groups")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<MaterialGroup> createGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @Valid @RequestBody MaterialGroupRequest req) {
        return ApiResponse.ok(service.createGroup(principal.tenantId(), req));
    }

    @PutMapping("/material-groups/{id}")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<MaterialGroup> updateGroup(@AuthenticationPrincipal AuthPrincipal principal,
                                                  @PathVariable Long id,
                                                  @Valid @RequestBody MaterialGroupRequest req) {
        return ApiResponse.ok(service.updateGroup(principal.tenantId(), id, req));
    }

    @DeleteMapping("/material-groups/{id}")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<Void> deleteGroup(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.deleteGroup(principal.tenantId(), id);
        return ApiResponse.ok(null);
    }

    @GetMapping("/materials")
    @PreAuthorize("hasAuthority('material:read')")
    public ApiResponse<List<MaterialVO>> list(@AuthenticationPrincipal AuthPrincipal principal,
                                              @RequestParam(required = false) Long groupId,
                                              @RequestParam(required = false) Integer type,
                                              @RequestParam(required = false) String keyword,
                                              @RequestParam(required = false) String ownerScope,
                                              @RequestParam(required = false) Long customerId) {
        return ApiResponse.ok(service.list(principal.tenantId(), principal.userId(), groupId, type,
            keyword, ownerScope, customerId));
    }

    @PostMapping("/materials")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<MaterialVO> create(@AuthenticationPrincipal AuthPrincipal principal,
                                          @Valid @RequestBody MaterialRequest req) {
        return ApiResponse.ok(service.create(principal.tenantId(), principal.userId(), req));
    }

    @PutMapping("/materials/{id}")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<MaterialVO> update(@AuthenticationPrincipal AuthPrincipal principal,
                                          @PathVariable Long id,
                                          @Valid @RequestBody MaterialRequest req) {
        return ApiResponse.ok(service.update(principal.tenantId(), principal.userId(), id, req));
    }

    @DeleteMapping("/materials/{id}")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<Void> delete(@AuthenticationPrincipal AuthPrincipal principal, @PathVariable Long id) {
        service.delete(principal.tenantId(), principal.userId(), id);
        return ApiResponse.ok(null);
    }

    /**
     * Upload a media file. Returns the URL to assign to a material (via POST /api/materials).
     * The upload is independent of the material row so the picker can be reused for create and
     * edit; the file is named by UUID and therefore un-guessable.
     */
    @PostMapping(value = "/materials/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<MaterialMediaVO> uploadMedia(@AuthenticationPrincipal AuthPrincipal principal,
                                                    @RequestParam("file") MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new BizException(40000, "未选择文件");
        }
        String storedName = mediaStorage.store(file.getInputStream(), file.getOriginalFilename(),
            file.getContentType());
        MaterialMediaVO vo = new MaterialMediaVO(
            MediaStorageService.MEDIA_URL_PREFIX + storedName, file.getContentType(), file.getSize());
        return ApiResponse.ok(vo);
    }

    /**
     * Serve a stored media file. {@code permitAll} in SecurityConfig: an {@code <img>}/{@code <video>}
     * tag does not send the Bearer token, so the URL filter chain cannot require auth. Method-level
     * security ({@code material:read}) still applies on top of it.
     *
     * <p><b>为什么强制 attachment</b>：只要响应是 {@code inline}，浏览器就会在<b>本应用源</b>下
     * 解释内容。SVG 能内嵌 {@code <script>}、HTML 能带事件处理器，两者一旦被当作 inline 资源
     * 直出，就是存储型 XSS——攻击者上传一个"图"，受害者打开即在自己的应用源里执行脚本，
     * 能读到 localStorage 里的 token。反过来，{@code Content-Disposition: attachment} 让浏览器
     * 一律当下载处理，绝不渲染，{@code nosniff} 再堵死"猜 MIME"这条路。
     *
     * <p>代价是图片不再内联预览，要改成先下载再由前端 blob 预览。这是为了消除 XSS 付的价钱，
     * 与 {@code nosniff} 一起构成两道独立防线——任一道单独存在都够，两道都在更稳。
     */
    @GetMapping("/materials/media/{name}")
    @PreAuthorize("hasAuthority('material:read')")
    public void serveMedia(@PathVariable String name, HttpServletResponse response) throws IOException {
        Path p = mediaStorage.serve(name);
        if (p == null) {
            response.sendError(HttpServletResponse.SC_NOT_FOUND);
            return;
        }
        response.setContentType(mediaStorage.mimeOf(p));
        response.setContentLengthLong(Files.size(p));
        // 强制下载而非内联渲染：堵住 SVG/HTML 的存储型 XSS
        response.setHeader("Content-Disposition",
            "attachment; filename=\"" + Path.of(name).getFileName() + "\"");
        // 禁止 MIME 嗅探，避免"声明 image/png 实为 HTML"这类绕过
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
        response.setHeader("Cache-Control", "private, max-age=86400");
        Files.copy(p, response.getOutputStream());
        response.flushBuffer();
    }

    @DeleteMapping("/materials/media/{name}")
    @PreAuthorize("hasAuthority('material:write')")
    public ApiResponse<Void> deleteMedia(@PathVariable String name) {
        mediaStorage.delete(name);
        return ApiResponse.ok(null);
    }
}
